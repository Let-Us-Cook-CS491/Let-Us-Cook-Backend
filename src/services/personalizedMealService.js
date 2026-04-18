const db = require('../config/databaseConnection');
const { connectMongo } = require('../config/databaseConnection');
const FridgeItem = require('../schemes/fridgeItem');
const UserPreference = require('../schemes/userPreferences');
const { filterByMainIngredient, lookupMeal } = require('./theMealDbClient');
const { personalizeWithGemini } = require('./geminiMealPersonalizer');

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 15;
const DEFAULT_MAX_MISSING_INGREDIENTS = 4;
const MAX_CANDIDATE_LOOKUPS = 35;
const DEFAULT_INCLUDE_REASONS = true;

function normalizeIngredient(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function fridgeNameToFilterIngredient(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function collectMealIngredientsNormalized(meal) {
  const out = [];
  for (let i = 1; i <= 20; i += 1) {
    const ingredient = normalizeIngredient(meal[`strIngredient${i}`]);
    if (ingredient) out.push(ingredient);
  }
  return [...new Set(out)];
}

function extractMinutes(meal) {
  const instructionText = String(meal?.strInstructions || '');
  const minutesMatch = instructionText.match(/(\d+)\s*(minutes|min)/i);
  if (!minutesMatch) return null;
  const value = Number(minutesMatch[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseRestrictionTerms(preferences) {
  const restrictions = Array.isArray(preferences?.restrictions) ? preferences.restrictions : [];
  const currentDiet = String(preferences?.current_diet || '').trim().toLowerCase();
  const terms = restrictions.map((x) => normalizeIngredient(x)).filter(Boolean);

  // Baseline diet keyword mapping for guardrails when no explicit classifier exists.
  if (currentDiet.includes('vegetarian')) {
    terms.push('chicken', 'beef', 'pork', 'fish', 'shrimp', 'lamb');
  }
  if (currentDiet.includes('vegan')) {
    terms.push('chicken', 'beef', 'pork', 'fish', 'shrimp', 'lamb', 'egg', 'milk', 'cheese', 'butter');
  }

  return [...new Set(terms)];
}

function violatesRestrictions(recipeIngredients, restrictionTerms) {
  if (!restrictionTerms.length) return false;
  return recipeIngredients.some((ing) => restrictionTerms.some((term) => ing.includes(term)));
}

function deterministicRank(candidates, limit, includeReasons) {
  const ranked = [...candidates].sort((a, b) => {
    if (a.missingIngredients.length !== b.missingIngredients.length) {
      return a.missingIngredients.length - b.missingIngredients.length;
    }
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    return String(a.strMeal || '').localeCompare(String(b.strMeal || ''));
  });

  return ranked.slice(0, limit).map((recipe) => ({
    ...recipe,
    personalization: {
      strategy: 'deterministic_fallback',
      score: Math.max(1, Math.min(100, 100 - recipe.missingIngredients.length * 12)),
      effort: recipe.missingIngredients.length <= 2 ? 'easy' : 'medium',
      cookMinutes: recipe.cookMinutesEstimate,
      reason: includeReasons
        ? 'Ranked by ingredient overlap, fewer missing items, and your saved preferences.'
        : undefined,
    },
  }));
}

async function readHealthGoals(userId) {
  const query = `
    SELECT goal, activity_level, calorie_target
    FROM health_goals
    WHERE user_id = ?
    LIMIT 1;
  `;
  const [rows] = await db.query(query, [userId]);
  return rows?.[0] || null;
}

function buildRecipePayload(meal, matchCount, fridgeNameSet) {
  const recipeIngredients = collectMealIngredientsNormalized(meal);
  const matchedIngredients = recipeIngredients.filter((ing) => fridgeNameSet.has(ing));
  const missingIngredients = recipeIngredients.filter((ing) => !fridgeNameSet.has(ing));

  return {
    idMeal: String(meal.idMeal),
    strMeal: meal.strMeal,
    strMealThumb: meal.strMealThumb,
    strCategory: meal.strCategory,
    strArea: meal.strArea,
    strInstructions: meal.strInstructions,
    recipeIngredients,
    matchedIngredients,
    missingIngredients,
    matchCount,
    cookMinutesEstimate: extractMinutes(meal),
  };
}

async function buildCandidates(fridgeNames, maxMissingIngredients) {
  const filterResults = await Promise.all(
    fridgeNames.map(async (name) => {
      try {
        return await filterByMainIngredient(fridgeNameToFilterIngredient(name));
      } catch (err) {
        return { meals: null };
      }
    })
  );

  const idToMatchCount = new Map();
  for (const result of filterResults) {
    const meals = result?.meals;
    if (!Array.isArray(meals)) continue;
    for (const meal of meals) {
      if (!meal?.idMeal) continue;
      idToMatchCount.set(meal.idMeal, (idToMatchCount.get(meal.idMeal) || 0) + 1);
    }
  }

  const scoreRows = [...idToMatchCount.entries()]
    .map(([idMeal, matchCount]) => ({ idMeal, matchCount }))
    .sort((a, b) => b.matchCount - a.matchCount);

  const idsToLookup = scoreRows.slice(0, MAX_CANDIDATE_LOOKUPS).map((row) => row.idMeal);
  const fridgeNameSet = new Set(fridgeNames.map((name) => normalizeIngredient(name)));
  const scoreMap = new Map(scoreRows.map((row) => [row.idMeal, row.matchCount]));

  const lookedUp = await Promise.all(
    idsToLookup.map(async (idMeal) => {
      try {
        return await lookupMeal(idMeal);
      } catch (err) {
        return null;
      }
    })
  );

  return lookedUp
    .filter(Boolean)
    .map((meal) => buildRecipePayload(meal, scoreMap.get(meal.idMeal) || 0, fridgeNameSet))
    .filter((recipe) => recipe.missingIngredients.length <= maxMissingIngredients);
}

function createPersonalizedMealService(deps = {}) {
  const loadMongo = deps.connectMongo || connectMongo;
  const readPreferences = deps.readPreferences || ((userId) => UserPreference.findOne({ user_id: userId }).lean());
  const readInventory =
    deps.readInventory ||
    ((userId) => FridgeItem.find({ user_id: userId }, { name: 1 }).sort({ expiration_date: 1 }).lean());
  const readGoals = deps.readHealthGoals || readHealthGoals;
  const createCandidates = deps.buildCandidates || buildCandidates;
  const aiPersonalizer = deps.personalizeWithGemini || personalizeWithGemini;

  async function getPersonalizedRecommendations({
    userId,
    limit = DEFAULT_LIMIT,
    maxMissingIngredients = DEFAULT_MAX_MISSING_INGREDIENTS,
    includeReasons = DEFAULT_INCLUDE_REASONS,
  }) {
    await loadMongo();

    const [preferences, healthGoals, inventory] = await Promise.all([
      readPreferences(userId),
      readGoals(userId),
      readInventory(userId),
    ]);

    const fridgeNames = [...new Set(inventory.map((item) => normalizeIngredient(item.name)).filter(Boolean))];
    if (!fridgeNames.length) {
      return {
        recommendations: [],
        meta: { strategy: 'none', candidateCount: 0 },
      };
    }

    const restrictionTerms = parseRestrictionTerms(preferences);
    const candidateRecipes = (await createCandidates(fridgeNames, maxMissingIngredients)).filter(
      (recipe) => !violatesRestrictions(recipe.recipeIngredients, restrictionTerms)
    );

    if (!candidateRecipes.length) {
      return {
        recommendations: [],
        meta: { strategy: 'guardrail_filtered', candidateCount: 0 },
      };
    }

    const promptProfile = {
      currentDiet: preferences?.current_diet || 'Everything',
      restrictions: preferences?.restrictions || [],
      allowSubstitutions: preferences?.allow_substitutions === true,
      healthGoal: healthGoals?.goal || null,
      activityLevel: healthGoals?.activity_level || null,
      calorieTarget: healthGoals?.calorie_target ?? null,
      fridgeHighlights: fridgeNames.slice(0, 20),
    };

    const promptCandidates = candidateRecipes.slice(0, 20).map((recipe) => ({
      idMeal: recipe.idMeal,
      name: recipe.strMeal,
      category: recipe.strCategory || null,
      area: recipe.strArea || null,
      matchedIngredients: recipe.matchedIngredients,
      missingIngredients: recipe.missingIngredients,
      matchCount: recipe.matchCount,
      cookMinutesEstimate: recipe.cookMinutesEstimate,
    }));

    try {
      const aiResponse = await aiPersonalizer({
        profile: promptProfile,
        candidates: promptCandidates,
        limit: Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT),
        includeReasons,
      });

      const byId = new Map(candidateRecipes.map((recipe) => [recipe.idMeal, recipe]));
      const merged = [];
      for (const item of aiResponse.recommendations) {
        const recipe = byId.get(item.idMeal);
        if (!recipe) continue;
        merged.push({
          ...recipe,
          personalization: {
            strategy: 'llm_first',
            score: item.personalizationScore,
            effort: item.effort,
            cookMinutes: item.cookMinutes ?? recipe.cookMinutesEstimate,
            reason: includeReasons ? item.reason : undefined,
          },
        });
      }

      if (merged.length) {
        return {
          recommendations: merged.slice(0, limit),
          meta: { strategy: 'llm_first', candidateCount: candidateRecipes.length },
        };
      }
    } catch (err) {
      console.error('personalized LLM fallback:', err?.message || err);
    }

    return {
      recommendations: deterministicRank(candidateRecipes, limit, includeReasons),
      meta: { strategy: 'deterministic_fallback', candidateCount: candidateRecipes.length },
    };
  }

  return {
    getPersonalizedRecommendations,
  };
}

module.exports = {
  createPersonalizedMealService,
  getPersonalizedRecommendations: createPersonalizedMealService().getPersonalizedRecommendations,
  __private: {
    deterministicRank,
    parseRestrictionTerms,
    violatesRestrictions,
  },
};
