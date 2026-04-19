const FridgeItem = require('../schemes/fridgeItem');
const UserPreference = require('../schemes/userPreferences');
const { connectMongo } = require('../config/databaseConnection');
const { filterByMainIngredient } = require('./theMealDbClient');
const { lookupMealsMongoFirst } = require('./mealDbRecipeCacheService');
const { resolveFridgeIdForUser } = require('./userFridgeResolver');
const { buildFridgeMatchingFromInventory, normalizeFridgeName } = require('./fridgeInventoryMatching');
const { loadMacrosLookupMap, buildRecipeNutritionFromMeal } = require('./recipeNutritionService');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const DEFAULT_MAX_INGREDIENTS = 8;
const MAX_MAX_INGREDIENTS = 12;
const MIN_LOOKUP_CANDIDATES = 15;
const MAX_TOTAL_LOOKUPS_STRICT = 50;

function parsePositiveInt(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

function normalizeIngredientForMatch(raw) {
  return normalizeFridgeName(raw);
}

function collectMealIngredientsNormalized(meal) {
  const out = [];
  for (let i = 1; i <= 20; i += 1) {
    const norm = normalizeIngredientForMatch(meal[`strIngredient${i}`]);
    if (norm) out.push(norm);
  }
  return out;
}

function buildRecipePayload(meal, matchCount, fridgeNameSet, macroMap) {
  const normalizedRecipeIngs = collectMealIngredientsNormalized(meal);
  const recipeIngredients = [...new Set(normalizedRecipeIngs)];
  const matchedIngredients = recipeIngredients.filter((ing) => fridgeNameSet.has(ing));
  const missingIngredients = recipeIngredients.filter((ing) => !fridgeNameSet.has(ing));
  const nutrition = buildRecipeNutritionFromMeal(meal, macroMap);
  return {
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
    nutrition,
  };
}

function lookupChunkSize(limit) {
  return Math.min(Math.max(limit * 2, MIN_LOOKUP_CANDIDATES), MAX_TOTAL_LOOKUPS_STRICT);
}

function attachMatchingMeta(data, matching) {
  if (!matching?.matchingHeuristicUsed) {
    return data;
  }
  return {
    ...data,
    matchingHeuristicUsed: true,
    matchingDisclaimer: matching.matchingDisclaimer,
    expandedInventoryNames: matching.expandedInventoryNames,
  };
}

/**
 * @param {{ userId: number, limit?: number, maxIngredients?: number }} params
 * @returns {Promise<
 *   | { kind: 'error'; status: number; body: { status: string; message: string } }
 *   | { kind: 'success'; status: number; body: { status: string; message: string; data: object } }
 * >}
 */
async function runSuggestFromFridge(params) {
  const userId = Number(params.userId);
  const limit = parsePositiveInt(params.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const maxIngredients = parsePositiveInt(
    params.maxIngredients,
    DEFAULT_MAX_INGREDIENTS,
    MAX_MAX_INGREDIENTS
  );

  await connectMongo();

  const fridgeResolution = await resolveFridgeIdForUser(userId);
  if (fridgeResolution.status === 'USER_NOT_FOUND') {
    return { kind: 'error', status: 404, body: { status: 'ERROR', message: 'User not found' } };
  }
  if (fridgeResolution.status === 'INVALID_FRIDGE') {
    return {
      kind: 'error',
      status: 400,
      body: { status: 'ERROR', message: 'User does not have a valid fridge' },
    };
  }

  const { fridgeId } = fridgeResolution;

  const [prefs, fridgeItems] = await Promise.all([
    UserPreference.findOne({ user_id: userId }).lean(),
    FridgeItem.find({ fridge_id: fridgeId }, { name: 1, expiration_date: 1 })
      .sort({ expiration_date: 1, name: 1 })
      .lean(),
  ]);

  const allowSubstitutions = prefs?.allow_substitutions === true;

  if (!fridgeItems.length) {
    return {
      kind: 'success',
      status: 200,
      body: {
        status: 'OK',
        message: 'No fridge items to suggest from',
        data: {
          recipes: [],
          allowSubstitutions,
          filteredByMissing: false,
        },
      },
    };
  }

  const matching = buildFridgeMatchingFromInventory(fridgeItems, maxIngredients);
  const { filterKeys, fridgeNameSet, matchingHeuristicUsed, expandedInventoryNames, matchingDisclaimer } =
    matching;

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
    return {
      kind: 'success',
      status: 200,
      body: {
        status: 'OK',
        message: 'No matching recipes found for your ingredients',
        data: attachMatchingMeta(
          {
            recipes: [],
            allowSubstitutions,
            filteredByMissing: !allowSubstitutions,
          },
          matching
        ),
      },
    };
  }

  let macroMap = new Map();
  try {
    macroMap = await loadMacrosLookupMap();
  } catch (e) {
    console.error('Macros collection load error:', e?.message || e);
  }

  const scored = [...idToMatchCount.entries()].map(([idMeal, matchCount]) => ({
    idMeal,
    matchCount,
  }));
  scored.sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    return String(a.idMeal).localeCompare(String(b.idMeal));
  });

  const matchCountById = new Map(scored.map((s) => [s.idMeal, s.matchCount]));

  let recipes = [];
  const filteredByMissing = !allowSubstitutions;

  if (allowSubstitutions) {
    const lookupPoolSize = Math.min(scored.length, Math.max(limit * 2, MIN_LOOKUP_CANDIDATES));
    const idsToLookup = scored.slice(0, lookupPoolSize).map((s) => s.idMeal);

    let meals;
    try {
      meals = await lookupMealsMongoFirst(idsToLookup);
    } catch (e) {
      console.error('Recipe lookup error:', e?.message || e);
      meals = idsToLookup.map(() => null);
    }
    const lookups = idsToLookup.map((idMeal, idx) => ({ idMeal, meal: meals[idx] ?? null }));

    for (const { idMeal, meal } of lookups) {
      if (!meal) continue;
      const matchCount = matchCountById.get(idMeal) || 0;
      recipes.push(buildRecipePayload(meal, matchCount, fridgeNameSet, macroMap));
    }

    recipes.sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return String(a.strMeal || '').localeCompare(String(b.strMeal || ''));
    });
  } else {
    const strictRecipes = [];
    const seenRecipeIds = new Set();
    let cursor = 0;
    let lookupsDone = 0;
    const chunkCap = lookupChunkSize(limit);

    while (
      strictRecipes.length < limit &&
      cursor < scored.length &&
      lookupsDone < MAX_TOTAL_LOOKUPS_STRICT
    ) {
      const room = MAX_TOTAL_LOOKUPS_STRICT - lookupsDone;
      const remaining = scored.length - cursor;
      const chunk = Math.min(chunkCap, remaining, room);
      if (chunk <= 0) break;

      const idsBatch = scored.slice(cursor, cursor + chunk).map((s) => s.idMeal);
      cursor += chunk;
      lookupsDone += idsBatch.length;

      let meals;
      try {
        meals = await lookupMealsMongoFirst(idsBatch);
      } catch (e) {
        console.error('Recipe lookup error:', e?.message || e);
        meals = idsBatch.map(() => null);
      }
      const lookups = idsBatch.map((idMeal, idx) => ({ idMeal, meal: meals[idx] ?? null }));

      for (const { idMeal, meal } of lookups) {
        if (!meal || seenRecipeIds.has(idMeal)) continue;
        seenRecipeIds.add(idMeal);
        const matchCount = matchCountById.get(idMeal) || 0;
        const recipe = buildRecipePayload(meal, matchCount, fridgeNameSet, macroMap);
        if (recipe.missingIngredients.length === 0) {
          strictRecipes.push(recipe);
        }
      }
    }

    strictRecipes.sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return String(a.strMeal || '').localeCompare(String(b.strMeal || ''));
    });
    recipes = strictRecipes;
  }

  const limited = recipes.slice(0, limit);

  const message =
    !allowSubstitutions && limited.length === 0
      ? 'No recipes fully covered by your fridge without substitutions'
      : 'Recipe suggestions';

  const baseData = {
    recipes: limited,
    allowSubstitutions,
    filteredByMissing,
  };

  const data = attachMatchingMeta(baseData, {
    matchingHeuristicUsed,
    expandedInventoryNames,
    matchingDisclaimer,
  });

  return {
    kind: 'success',
    status: 200,
    body: {
      status: 'OK',
      message,
      data,
    },
  };
}

module.exports = {
  runSuggestFromFridge,
  parsePositiveInt,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  DEFAULT_MAX_INGREDIENTS,
  MAX_MAX_INGREDIENTS,
};
