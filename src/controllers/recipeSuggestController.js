const FridgeItem = require('../schemes/fridgeItem');
const { connectMongo } = require('../config/databaseConnection');
const { filterByMainIngredient, lookupMeal } = require('../services/theMealDbClient');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const DEFAULT_MAX_INGREDIENTS = 8;
const MAX_MAX_INGREDIENTS = 12;
/** Minimum candidate pool before capping by list length (see plan: max(limit × 2, 15)). */
const MIN_LOOKUP_CANDIDATES = 15;

function parsePositiveInt(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

function fridgeNameToFilterIngredient(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function normalizeIngredientForMatch(raw) {
  if (raw == null || typeof raw !== 'string') return '';
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return s || '';
}

function collectMealIngredientsNormalized(meal) {
  const out = [];
  for (let i = 1; i <= 20; i += 1) {
    const norm = normalizeIngredientForMatch(meal[`strIngredient${i}`]);
    if (norm) out.push(norm);
  }
  return out;
}

exports.suggestRecipesFromFridge = async (req, res) => {
  try {
    await connectMongo();

    const rawUserId = req.user?.user_id;
    const user_id = Number(rawUserId);
    if (!Number.isInteger(user_id)) {
      return res.status(401).json({
        status: 'ERROR',
        message: 'Unauthorized',
      });
    }

    const limit = parsePositiveInt(req.query?.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const maxIngredients = parsePositiveInt(
      req.query?.maxIngredients,
      DEFAULT_MAX_INGREDIENTS,
      MAX_MAX_INGREDIENTS
    );

    const fridgeItems = await FridgeItem.find({ user_id }, { name: 1, expiration_date: 1 })
      .sort({ expiration_date: 1, name: 1 })
      .lean();

    if (!fridgeItems.length) {
      return res.status(200).json({
        status: 'OK',
        message: 'No fridge items to suggest from',
        data: {
          recipes: [],
        },
      });
    }

    const seenNames = new Set();
    const uniqueByName = [];
    for (const item of fridgeItems) {
      const n = String(item.name || '').trim().toLowerCase();
      if (!n || seenNames.has(n)) continue;
      seenNames.add(n);
      uniqueByName.push({ ...item, name: n });
    }

    const ingredientRows = uniqueByName.slice(0, maxIngredients);
    const filterKeys = ingredientRows.map((row) => fridgeNameToFilterIngredient(row.name));

    const fridgeNameSet = new Set(fridgeItems.map((i) => String(i.name || '').trim().toLowerCase()).filter(Boolean));

    const filterResults = await Promise.all(
      filterKeys.map(async (key) => {
        try {
          return await filterByMainIngredient(key);
        } catch (e) {
          console.error('TheMealDB filter error:', key, e?.message || e);
          return { meals: null };
        }
      })
    );

    const idToMatchCount = new Map();
    for (const json of filterResults) {
      const meals = json?.meals;
      if (!Array.isArray(meals)) continue;
      for (const m of meals) {
        const id = m?.idMeal;
        if (!id) continue;
        idToMatchCount.set(id, (idToMatchCount.get(id) || 0) + 1);
      }
    }

    if (idToMatchCount.size === 0) {
      return res.status(200).json({
        status: 'OK',
        message: 'No matching recipes found for your ingredients',
        data: {
          recipes: [],
        },
      });
    }

    const scored = [...idToMatchCount.entries()].map(([idMeal, matchCount]) => ({
      idMeal,
      matchCount,
    }));
    scored.sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return String(a.idMeal).localeCompare(String(b.idMeal));
    });

    const lookupPoolSize = Math.min(
      scored.length,
      Math.max(limit * 2, MIN_LOOKUP_CANDIDATES)
    );
    const idsToLookup = scored.slice(0, lookupPoolSize).map((s) => s.idMeal);

    const lookups = await Promise.all(
      idsToLookup.map(async (idMeal) => {
        try {
          const meal = await lookupMeal(idMeal);
          return { idMeal, meal };
        } catch (e) {
          console.error('TheMealDB lookup error:', idMeal, e?.message || e);
          return { idMeal, meal: null };
        }
      })
    );

    const matchCountById = new Map(scored.map((s) => [s.idMeal, s.matchCount]));

    const recipes = [];
    for (const { idMeal, meal } of lookups) {
      if (!meal) continue;
      const matchCount = matchCountById.get(idMeal) || 0;
      const normalizedRecipeIngs = collectMealIngredientsNormalized(meal);
      const recipeIngredients = [...new Set(normalizedRecipeIngs)];
      const matchedIngredients = recipeIngredients.filter((ing) => fridgeNameSet.has(ing));
      const missingIngredients = recipeIngredients.filter((ing) => !fridgeNameSet.has(ing));
      recipes.push({
        idMeal: meal.idMeal,
        strMeal: meal.strMeal,
        strMealThumb: meal.strMealThumb,
        strCategory: meal.strCategory,
        strArea: meal.strArea,
        strInstructions: meal.strInstructions,
        matchCount,
        recipeIngredients,
        matchedIngredients,
        missingIngredients,
      });
    }

    recipes.sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return String(a.strMeal || '').localeCompare(String(b.strMeal || ''));
    });

    const limited = recipes.slice(0, limit);

    return res.status(200).json({
      status: 'OK',
      message: 'Recipe suggestions',
      data: {
        recipes: limited,
      },
    });
  } catch (err) {
    console.error('suggestRecipesFromFridge error:', err);
    return res.status(500).json({
      status: 'ERROR',
      message: 'Failed to suggest recipes',
    });
  }
};
