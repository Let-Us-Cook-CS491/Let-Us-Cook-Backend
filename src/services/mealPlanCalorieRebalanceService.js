const { connectMongo } = require('../config/databaseConnection');
const MealPlan = require('../schemes/mealPlan');
const Recipie = require('../schemes/recipie');
const UserPreference = require('../schemes/userPreferences');
const { readHealthGoals } = require('./personalizedMealService');
const { getPersonalizedRecommendations } = require('./personalizedMealService');
const {
    SLOT_KEYS,
    startOfUtcWeekMonday,
    utcDateKey,
} = require('./weeklyMealPlanService');

const DEFAULT_TOLERANCE_PERCENT = 0.10;
const DEFAULT_TOLERANCE_MIN_KCAL = 100;
const DEFAULT_MAX_ITERATIONS_PER_DAY = 30;

/**
 * Extract calories from a slot's nutrition_snapshot.
 */
function getSlotCalories(slot) {
    return Number(slot?.nutrition_snapshot?.calories) || 0;
}

/**
 * Calculate total calories for a day.
 */
function calculateDayTotal(day) {
    let total = 0;
    for (const slotKey of SLOT_KEYS) {
        const slot = day?.slots?.[slotKey];
        if (slot) {
            total += getSlotCalories(slot);
        }
    }
    return total;
}

/**
 * Build a unique key for tracking used recipes.
 */
function buildRecipeKey(slot) {
    if (!slot) return null;
    if (slot.source === 'mongo' && slot.recipe_id) {
        return `m:${slot.recipe_id}`;
    }
    if (slot.source === 'mealdb' && slot.idMeal) {
        return `d:${slot.idMeal}`;
    }
    return null;
}

/**
 * Build slot from Mongo document.
 */
function buildSlotFromMongo(doc) {
    const assigned_at = new Date();
    const n = doc?.nutrition;
    const nutrition_snapshot = n && typeof n === 'object'
        ? {
            calories: Number(n.calories ?? n.calories_kcal) || 0,
            protein: Number(n.protein ?? n.protein_g) || 0,
            carbs: Number(n.carbs ?? n.carbohydrates_g ?? n.carbohydrates) || 0,
            fat: Number(n.fat ?? n.fat_g) || 0,
        }
        : undefined;

    return {
        source: 'mongo',
        recipe_id: doc._id,
        title: String(doc.title || 'Recipe'),
        image_url: String(doc.image_url || doc.imageUrl || doc.strMealThumb || ''),
        prep_minutes: Number(doc.prep_minutes ?? doc.prepMinutes ?? 30) || 30,
        nutrition_snapshot,
        assigned_at,
    };
}

/**
 * Build slot from MealDB recipe.
 */
function buildSlotFromMealdb(recipe) {
    const assigned_at = new Date();
    const cook =
        recipe?.personalization?.cookMinutes ??
        recipe?.cookMinutesEstimate ??
        recipe?.cookMinutes ??
        30;

    const t = recipe?.nutrition?.totals;
    const nutrition_snapshot = t && typeof t === 'object'
        ? {
            calories: Number(t.calories_kcal) || 0,
            protein: Number(t.protein_g) || 0,
            carbs: Number(t.carbohydrates_g) || 0,
            fat: Number(t.fat_g) || 0,
        }
        : undefined;

    return {
        source: 'mealdb',
        idMeal: String(recipe.idMeal),
        title: String(recipe.strMeal || 'Recipe'),
        image_url: String(recipe.strMealThumb || ''),
        prep_minutes: Number(cook) || 30,
        nutrition_snapshot,
        assigned_at,
    };
}

/**
 * Load candidate pool for rebalancing.
 */
async function loadRebalanceCandidatePool(userId, useFridge, mongoSampleSize) {
    const pool = [];

    // Load Mongo candidates
    const size = Math.min(Math.max(Number(mongoSampleSize) || 40, 1), 80);
    const mongoDocs = await Recipie.aggregate([{ $sample: { size } }]);
    for (const doc of mongoDocs) {
        if (doc?._id) {
            pool.push({ kind: 'mongo', doc, calories: getSlotCalories(buildSlotFromMongo(doc)) });
        }
    }

    // Load MealDB candidates if useFridge is enabled
    if (useFridge) {
        const prefs = await UserPreference.findOne({ user_id: userId }).lean();
        const allowSubstitutions = prefs?.allow_substitutions === true;

        try {
            const result = await getPersonalizedRecommendations({
                userId,
                limit: 15,
                maxMissingIngredients: allowSubstitutions ? 4 : 0,
                includeReasons: false,
            });

            const recipes = Array.isArray(result.recommendations) ? result.recommendations : [];
            for (const r of recipes) {
                if (r?.idMeal) {
                    pool.push({ kind: 'mealdb', recipe: r, calories: getSlotCalories(buildSlotFromMealdb(r)) });
                }
            }
        } catch (err) {
            console.error('Failed to load fridge candidates for rebalance:', err?.message || err);
        }
    }

    return pool;
}

/**
 * Find the best candidate to replace a slot when we need to lower calories.
 * Returns a candidate with strictly lower calories than the current slot.
 */
function findLowerCalorieCandidate(currentCalories, pool, usedKeys, targetCalories, dayTotal, tolerance) {
    const candidates = pool
        .filter((item) => {
            const key = item.kind === 'mongo' ? `m:${item.doc._id}` : `d:${item.recipe.idMeal}`;
            return !usedKeys.has(key) && item.calories < currentCalories;
        })
        .sort((a, b) => {
            // Prefer the largest reduction that doesn't drop us below target - tolerance
            const newTotalA = dayTotal - currentCalories + a.calories;
            const newTotalB = dayTotal - currentCalories + b.calories;
            const targetMin = targetCalories - tolerance;

            // Both would keep us above targetMin: prefer larger reduction
            if (newTotalA >= targetMin && newTotalB >= targetMin) {
                return a.calories - b.calories;
            }
            // One would drop below targetMin: prefer the one that stays above
            if (newTotalA >= targetMin) return -1;
            if (newTotalB >= targetMin) return 1;
            // Both drop below: prefer the one closer to targetMin
            return Math.abs(newTotalA - targetMin) - Math.abs(newTotalB - targetMin);
        });

    return candidates[0] || null;
}

/**
 * Find the best candidate to replace a slot when we need to raise calories.
 * Returns a candidate with strictly higher calories than the current slot.
 */
function findHigherCalorieCandidate(currentCalories, pool, usedKeys, targetCalories, dayTotal, tolerance) {
    const candidates = pool
        .filter((item) => {
            const key = item.kind === 'mongo' ? `m:${item.doc._id}` : `d:${item.recipe.idMeal}`;
            return !usedKeys.has(key) && item.calories > currentCalories;
        })
        .sort((a, b) => {
            // Prefer the largest increase that doesn't overshoot target + tolerance
            const newTotalA = dayTotal - currentCalories + a.calories;
            const newTotalB = dayTotal - currentCalories + b.calories;
            const targetMax = targetCalories + tolerance;

            // Both would keep us below targetMax: prefer larger increase
            if (newTotalA <= targetMax && newTotalB <= targetMax) {
                return b.calories - a.calories;
            }
            // One would overshoot targetMax: prefer the one that stays below
            if (newTotalA <= targetMax) return -1;
            if (newTotalB <= targetMax) return 1;
            // Both overshoot: prefer the one closer to targetMax
            return Math.abs(newTotalA - targetMax) - Math.abs(newTotalB - targetMax);
        });

    return candidates[0] || null;
}

/**
 * Rebalance a single day's calories.
 */
function rebalanceDay(day, targetCalories, tolerance, maxIterations, pool, usedKeys) {
    const swaps = [];
    let iterations = 0;
    let dayTotal = calculateDayTotal(day);
    const totalBefore = dayTotal;

    while (Math.abs(dayTotal - targetCalories) > tolerance && iterations < maxIterations) {
        iterations += 1;

        if (dayTotal > targetCalories) {
            // Over target: find highest-cal non-pinned slot and replace with lower-cal option
            let highestSlotKey = null;
            let highestCalories = -1;

            for (const slotKey of SLOT_KEYS) {
                const slot = day.slots?.[slotKey];
                if (slot && !slot.pinned) {
                    const cal = getSlotCalories(slot);
                    if (cal > highestCalories) {
                        highestCalories = cal;
                        highestSlotKey = slotKey;
                    }
                }
            }

            if (!highestSlotKey) break; // No non-pinned slots to swap

            const candidate = findLowerCalorieCandidate(highestCalories, pool, usedKeys, targetCalories, dayTotal, tolerance);
            if (!candidate) break; // No suitable replacement found

            const oldSlot = day.slots[highestSlotKey];
            const newSlot = candidate.kind === 'mongo'
                ? buildSlotFromMongo(candidate.doc)
                : buildSlotFromMealdb(candidate.recipe);

            day.slots[highestSlotKey] = newSlot;
            const key = buildRecipeKey(newSlot);
            if (key) usedKeys.add(key);

            dayTotal = dayTotal - highestCalories + candidate.calories;
            swaps.push({
                slot: highestSlotKey,
                from: oldSlot.title,
                to: newSlot.title,
                calories_change: candidate.calories - highestCalories,
            });

        } else {
            // Under target: prefer filling null slot, otherwise replace lowest-cal non-pinned slot
            let nullSlotKey = null;
            for (const slotKey of SLOT_KEYS) {
                if (!day.slots?.[slotKey]) {
                    nullSlotKey = slotKey;
                    break;
                }
            }

            if (nullSlotKey) {
                // Fill null slot with highest-cal feasible option
                const candidate = findHigherCalorieCandidate(0, pool, usedKeys, targetCalories, dayTotal, tolerance);
                if (!candidate) break;

                const newSlot = candidate.kind === 'mongo'
                    ? buildSlotFromMongo(candidate.doc)
                    : buildSlotFromMealdb(candidate.recipe);

                day.slots[nullSlotKey] = newSlot;
                const key = buildRecipeKey(newSlot);
                if (key) usedKeys.add(key);

                dayTotal += candidate.calories;
                swaps.push({
                    slot: nullSlotKey,
                    from: null,
                    to: newSlot.title,
                    calories_change: candidate.calories,
                });

            } else {
                // Replace lowest-cal non-pinned slot with higher-cal option
                let lowestSlotKey = null;
                let lowestCalories = Infinity;

                for (const slotKey of SLOT_KEYS) {
                    const slot = day.slots?.[slotKey];
                    if (slot && !slot.pinned) {
                        const cal = getSlotCalories(slot);
                        if (cal < lowestCalories) {
                            lowestCalories = cal;
                            lowestSlotKey = slotKey;
                        }
                    }
                }

                if (!lowestSlotKey) break; // No non-pinned slots to swap

                const candidate = findHigherCalorieCandidate(lowestCalories, pool, usedKeys, targetCalories, dayTotal, tolerance);
                if (!candidate) break;

                const oldSlot = day.slots[lowestSlotKey];
                const newSlot = candidate.kind === 'mongo'
                    ? buildSlotFromMongo(candidate.doc)
                    : buildSlotFromMealdb(candidate.recipe);

                day.slots[lowestSlotKey] = newSlot;
                const key = buildRecipeKey(newSlot);
                if (key) usedKeys.add(key);

                dayTotal = dayTotal - lowestCalories + candidate.calories;
                swaps.push({
                    slot: lowestSlotKey,
                    from: oldSlot.title,
                    to: newSlot.title,
                    calories_change: candidate.calories - lowestCalories,
                });
            }
        }
    }

    return {
        total_before: totalBefore,
        total_after: dayTotal,
        swaps,
    };
}

/**
 * Main rebalance function.
 */
async function rebalanceWeekPlanForCalories(userId, body) {
    await connectMongo();

    const weekStartMonday = startOfUtcWeekMonday(body?.weekStart);
    if (!weekStartMonday) {
        return { ok: false, status: 400, message: 'Invalid weekStart' };
    }

    // Load health goals
    const healthGoals = await readHealthGoals(userId);
    const calorieTarget = Number(healthGoals?.calorie_target);

    if (!calorieTarget || calorieTarget <= 0) {
        return {
            ok: true,
            plan: null,
            meta: {
                skipped_reason: 'No calorie_target set for user',
                calorie_target: null,
            },
        };
    }

    // Load meal plan
    const doc = await MealPlan.findOne({ user_id: userId, week_start: weekStartMonday });
    if (!doc) {
        return {
            ok: true,
            plan: null,
            meta: {
                skipped_reason: 'No meal plan found for this week',
                calorie_target: calorieTarget,
            },
        };
    }

    // Check if plan has any meals
    const hasAnyMeal = doc.days.some((day) =>
        SLOT_KEYS.some((slotKey) => day?.slots?.[slotKey] != null)
    );

    if (!hasAnyMeal) {
        return {
            ok: true,
            plan: doc.toObject(),
            meta: {
                skipped_reason: 'Meal plan is empty',
                calorie_target: calorieTarget,
            },
        };
    }

    // Calculate tolerance
    const toleranceKcal = body?.toleranceKcal != null
        ? Math.max(Number(body.toleranceKcal) || 0, 0)
        : Math.max(DEFAULT_TOLERANCE_MIN_KCAL, Math.round(DEFAULT_TOLERANCE_PERCENT * calorieTarget));

    const maxIterationsPerDay = body?.maxIterationsPerDay != null
        ? Math.max(Number(body.maxIterationsPerDay) || 1, 1)
        : DEFAULT_MAX_ITERATIONS_PER_DAY;

    const useFridge = body?.useFridge === true;
    const mongoSampleSize = body?.mongoSampleSize;

    // Load candidate pool
    const pool = await loadRebalanceCandidatePool(userId, useFridge, mongoSampleSize);

    if (!pool.length) {
        return {
            ok: true,
            plan: doc.toObject(),
            meta: {
                skipped_reason: 'No candidate recipes available for rebalancing',
                calorie_target: calorieTarget,
                tolerance_kcal: toleranceKcal,
            },
        };
    }

    // Track used recipes across the week
    const usedKeys = new Set();
    for (const day of doc.days) {
        for (const slotKey of SLOT_KEYS) {
            const slot = day?.slots?.[slotKey];
            const key = buildRecipeKey(slot);
            if (key) usedKeys.add(key);
        }
    }

    // Rebalance each day
    const perDay = [];
    for (const day of doc.days) {
        const dayKey = utcDateKey(day.date);
        const dayResult = rebalanceDay(day, calorieTarget, toleranceKcal, maxIterationsPerDay, pool, usedKeys);
        perDay.push({
            date: dayKey,
            ...dayResult,
        });
    }

    // Save updated plan
    await doc.save();

    return {
        ok: true,
        plan: doc.toObject(),
        meta: {
            calorie_target: calorieTarget,
            tolerance_kcal: toleranceKcal,
            per_day: perDay,
        },
    };
}

module.exports = {
    rebalanceWeekPlanForCalories,
};
