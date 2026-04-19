const { connectMongo } = require('../config/databaseConnection');
const MealPlan = require('../schemes/mealPlan');
const Recipie = require('../schemes/recipie');
const UserPreference = require('../schemes/userPreferences');
const { getPersonalizedRecommendations } = require('./personalizedMealService');

const SLOT_KEYS = ['breakfast', 'lunch', 'dinner'];

function addUtcDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Monday 00:00:00.000 UTC of the ISO week containing `input`. */
function startOfUtcWeekMonday(input) {
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(String(input));
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  const day = d.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + delta, 0, 0, 0, 0));
  return monday;
}

function utcDateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, '0');
  const day = String(x.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emptySlots() {
  return { breakfast: null, lunch: null, dinner: null };
}

function buildWeekDays(weekStartMonday) {
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addUtcDays(weekStartMonday, i);
    days.push({ date, slots: emptySlots() });
  }
  return days;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function nutritionFromMongoDoc(doc) {
  const n = doc?.nutrition;
  if (!n || typeof n !== 'object') return undefined;
  return {
    calories: Number(n.calories ?? n.calories_kcal) || 0,
    protein: Number(n.protein ?? n.protein_g) || 0,
    carbs: Number(n.carbs ?? n.carbohydrates_g ?? n.carbohydrates) || 0,
    fat: Number(n.fat ?? n.fat_g) || 0,
  };
}

function nutritionFromMealdbRecipe(recipe) {
  const t = recipe?.nutrition?.totals;
  if (!t || typeof t !== 'object') return undefined;
  return {
    calories: Number(t.calories_kcal) || 0,
    protein: Number(t.protein_g) || 0,
    carbs: Number(t.carbohydrates_g) || 0,
    fat: Number(t.fat_g) || 0,
  };
}

function buildSlotFromMongo(doc) {
  const assigned_at = new Date();
  return {
    source: 'mongo',
    recipe_id: doc._id,
    title: String(doc.title || 'Recipe'),
    image_url: String(doc.image_url || doc.imageUrl || doc.strMealThumb || ''),
    prep_minutes: Number(doc.prep_minutes ?? doc.prepMinutes ?? 30) || 30,
    nutrition_snapshot: nutritionFromMongoDoc(doc),
    assigned_at,
  };
}

function buildSlotFromMealdb(recipe) {
  const assigned_at = new Date();
  const cook =
    recipe?.personalization?.cookMinutes ??
    recipe?.cookMinutesEstimate ??
    recipe?.cookMinutes ??
    30;
  return {
    source: 'mealdb',
    idMeal: String(recipe.idMeal),
    title: String(recipe.strMeal || 'Recipe'),
    image_url: String(recipe.strMealThumb || ''),
    prep_minutes: Number(cook) || 30,
    nutrition_snapshot: nutritionFromMealdbRecipe(recipe),
    assigned_at,
  };
}

function cloneDays(days) {
  return JSON.parse(JSON.stringify(days));
}

function clearAllSlots(days) {
  const next = cloneDays(days);
  for (const day of next) {
    day.slots = emptySlots();
  }
  return next;
}

async function loadMongoCandidates(sampleSize) {
  const size = Math.min(Math.max(Number(sampleSize) || 40, 1), 80);
  const docs = await Recipie.aggregate([{ $sample: { size } }]);
  return docs;
}

async function loadFridgeCandidates(userId, allowSubstitutions) {
  const maxMissingIngredients = allowSubstitutions ? 4 : 0;
  const result = await getPersonalizedRecommendations({
    userId,
    limit: 15,
    maxMissingIngredients,
    includeReasons: false,
  });
  return {
    recipes: Array.isArray(result.recommendations) ? result.recommendations : [],
    meta: result.meta || {},
  };
}

function buildCandidatePool({ mongoDocs, mealdbRecipes, useFridge }) {
  const pool = [];
  for (const doc of mongoDocs) {
    if (doc?._id) pool.push({ kind: 'mongo', doc });
  }
  if (useFridge) {
    for (const r of mealdbRecipes) {
      if (r?.idMeal) pool.push({ kind: 'mealdb', recipe: r });
    }
  }
  shuffleInPlace(pool);
  return pool;
}

function pickNextSlotAssignment(pool, usedKeys, startIndex) {
  const n = pool.length;
  if (!n) return { assignment: null, nextIndex: startIndex };
  for (let step = 0; step < n * 2; step += 1) {
    const idx = (startIndex + step) % n;
    const item = pool[idx];
    const key = item.kind === 'mongo' ? `m:${item.doc._id}` : `d:${item.recipe.idMeal}`;
    if (!usedKeys.has(key)) {
      usedKeys.add(key);
      return {
        assignment: item.kind === 'mongo' ? buildSlotFromMongo(item.doc) : buildSlotFromMealdb(item.recipe),
        nextIndex: idx + 1,
      };
    }
  }
  const fallback = pool[startIndex % n];
  return {
    assignment:
      fallback.kind === 'mongo' ? buildSlotFromMongo(fallback.doc) : buildSlotFromMealdb(fallback.recipe),
    nextIndex: (startIndex + 1) % n,
  };
}

function planHasAnyMeal(days) {
  if (!Array.isArray(days)) return false;
  for (const day of days) {
    const s = day?.slots;
    if (!s || typeof s !== 'object') continue;
    for (const slotKey of SLOT_KEYS) {
      if (s[slotKey] != null) return true;
    }
  }
  return false;
}

function fillWeekDays(days, options) {
  const { replace, fillEmptyOnly, pool } = options;
  let next = cloneDays(days);
  if (replace) {
    next = clearAllSlots(next);
  }

  if (!pool.length) {
    return { days: next, filled: 0, meta: { poolSize: 0 } };
  }

  let rr = 0;
  let filled = 0;
  const usedKeys = new Set();

  for (const day of next) {
    for (const slotKey of SLOT_KEYS) {
      const current = day.slots?.[slotKey];
      if (fillEmptyOnly && !replace && current != null) {
        continue;
      }
      const { assignment, nextIndex } = pickNextSlotAssignment(pool, usedKeys, rr);
      rr = nextIndex;
      if (!assignment) continue;
      if (!day.slots) day.slots = emptySlots();
      day.slots[slotKey] = assignment;
      filled += 1;
    }
  }

  return { days: next, filled, meta: { poolSize: pool.length } };
}

async function getWeekPlan(userId, weekStartInput, { createIfMissing = true } = {}) {
  await connectMongo();
  const weekStartMonday = startOfUtcWeekMonday(weekStartInput);
  if (!weekStartMonday) {
    return { ok: false, status: 400, message: 'Invalid weekStart' };
  }

  let doc = await MealPlan.findOne({ user_id: userId, week_start: weekStartMonday });
  if (!doc && createIfMissing) {
    doc = await MealPlan.create({
      user_id: userId,
      week_start: weekStartMonday,
      days: buildWeekDays(weekStartMonday),
    });
  }
  if (!doc) {
    if (!createIfMissing) {
      return { ok: true, plan: null };
    }
    return { ok: false, status: 404, message: 'Meal plan not found for this week' };
  }

  return { ok: true, plan: doc.toObject ? doc.toObject() : doc };
}

async function listWeekPlans(userId, query) {
  await connectMongo();
  const rawLimit = Number(query?.limit);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 52, 1), 104);

  const filter = { user_id: userId };
  const before = query?.beforeWeekStart;
  if (before != null && before !== '') {
    const monday = startOfUtcWeekMonday(before);
    if (monday) {
      filter.week_start = { $lt: monday };
    }
  }

  const docs = await MealPlan.find(filter, { week_start: 1, days: 1, updatedAt: 1, createdAt: 1 })
    .sort({ week_start: -1 })
    .limit(limit)
    .lean();

  const weeks = docs.map((d) => ({
    week_start: d.week_start,
    updatedAt: d.updatedAt,
    createdAt: d.createdAt,
    has_meals: planHasAnyMeal(d.days),
  }));

  return { ok: true, weeks };
}

async function generateWeekPlan(userId, body) {
  await connectMongo();
  const weekStartMonday = startOfUtcWeekMonday(body?.weekStart);
  if (!weekStartMonday) {
    return { ok: false, status: 400, message: 'Invalid weekStart' };
  }

  const replace = body?.replace === true;
  const fillEmptyOnly = body?.fillEmptyOnly !== false;
  const useFridge = body?.useFridge === true;

  const prefs = await UserPreference.findOne({ user_id: userId }).lean();
  const allowSubstitutions = prefs?.allow_substitutions === true;

  let mealdbRecipes = [];
  let fridgeMeta = null;
  if (useFridge) {
    const fridge = await loadFridgeCandidates(userId, allowSubstitutions);
    mealdbRecipes = fridge.recipes;
    fridgeMeta = fridge.meta;
  }

  const mongoDocs = await loadMongoCandidates(body?.mongoSampleSize);

  const pool = buildCandidatePool({ mongoDocs, mealdbRecipes, useFridge });

  let doc = await MealPlan.findOne({ user_id: userId, week_start: weekStartMonday });
  if (!doc) {
    doc = await MealPlan.create({
      user_id: userId,
      week_start: weekStartMonday,
      days: buildWeekDays(weekStartMonday),
    });
  }

  const { days, filled, meta } = fillWeekDays(doc.days, { replace, fillEmptyOnly, pool });
  doc.days = days;
  await doc.save();

  const out = doc.toObject();
  return {
    ok: true,
    plan: out,
    meta: {
      filledSlots: filled,
      poolSize: meta.poolSize,
      useFridge,
      allowSubstitutions,
      fridgeStrategy: fridgeMeta?.strategy,
      candidateCount: fridgeMeta?.candidateCount,
    },
  };
}

async function patchWeekSlot(userId, body) {
  await connectMongo();
  if (body?.weekStart == null || body.weekStart === '') {
    return { ok: false, status: 400, message: 'weekStart is required' };
  }
  if (body?.date == null || body.date === '') {
    return { ok: false, status: 400, message: 'date is required' };
  }

  const weekStartMonday = startOfUtcWeekMonday(body?.weekStart);
  if (!weekStartMonday) {
    return { ok: false, status: 400, message: 'Invalid weekStart' };
  }

  if (!Object.prototype.hasOwnProperty.call(body || {}, 'slotData')) {
    return { ok: false, status: 400, message: 'slotData is required (use null to clear a slot)' };
  }

  const slot = String(body?.slot || '').toLowerCase();
  if (!SLOT_KEYS.includes(slot)) {
    return { ok: false, status: 400, message: 'slot must be breakfast, lunch, or dinner' };
  }

  const targetKey = utcDateKey(body?.date);
  if (!targetKey || targetKey.includes('NaN')) {
    return { ok: false, status: 400, message: 'Invalid date' };
  }

  const doc = await MealPlan.findOne({ user_id: userId, week_start: weekStartMonday });
  if (!doc) {
    return { ok: false, status: 404, message: 'Meal plan not found for this week' };
  }

  const days = cloneDays(doc.days);
  let found = false;
  for (const day of days) {
    if (utcDateKey(day.date) === targetKey) {
      if (!day.slots) day.slots = emptySlots();
      day.slots[slot] = body.slotData;
      found = true;
      break;
    }
  }

  if (!found) {
    return { ok: false, status: 400, message: 'date does not fall in this plan week' };
  }

  doc.days = days;
  await doc.save();

  return { ok: true, plan: doc.toObject() };
}

module.exports = {
  SLOT_KEYS,
  startOfUtcWeekMonday,
  utcDateKey,
  getWeekPlan,
  listWeekPlans,
  generateWeekPlan,
  patchWeekSlot,
};
