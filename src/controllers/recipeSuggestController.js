const FridgeItem = require('../schemes/fridgeItem');
const UserPreference = require('../schemes/userPreferences');
const { connectMongo } = require('../config/databaseConnection');
const { filterByMainIngredient, lookupMeal } = require('../services/theMealDbClient');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const DEFAULT_MAX_INGREDIENTS = 8;
const MAX_MAX_INGREDIENTS = 12;
/** Minimum candidate pool before capping by list length (see plan: max(limit × 2, 15)). */
const MIN_LOOKUP_CANDIDATES = 15;
/** Max TheMealDB lookups per suggest request when strict (no substitutions). */
const MAX_TOTAL_LOOKUPS_STRICT = 50;

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

function buildRecipePayload(meal, matchCount, fridgeNameSet) {
  const normalizedRecipeIngs = collectMealIngredientsNormalized(meal);
  const recipeIngredients = [...new Set(normalizedRecipeIngs)];
  const matchedIngredients = recipeIngredients.filter((ing) => fridgeNameSet.has(ing));
  const missingIngredients = recipeIngredients.filter((ing) => !fridgeNameSet.has(ing));
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
  };
}

function lookupChunkSize(limit) {
  return Math.min(Math.max(limit * 2, MIN_LOOKUP_CANDIDATES), MAX_TOTAL_LOOKUPS_STRICT);
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

    const [prefs, fridgeItems] = await Promise.all([
      UserPreference.findOne({ user_id }).lean(),
      FridgeItem.find({ user_id }, { name: 1, expiration_date: 1 })
        .sort({ expiration_date: 1, name: 1 })
        .lean(),
    ]);

    const allowSubstitutions = prefs?.allow_substitutions === true;

    if (!fridgeItems.length) {
      return res.status(200).json({
        status: 'OK',
        message: 'No fridge items to suggest from',
        data: {
          recipes: [],
          allowSubstitutions,
          filteredByMissing: false,
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
          allowSubstitutions,
          filteredByMissing: !allowSubstitutions,
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

    const matchCountById = new Map(scored.map((s) => [s.idMeal, s.matchCount]));

    let recipes = [];
    const filteredByMissing = !allowSubstitutions;

    if (allowSubstitutions) {
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

      for (const { idMeal, meal } of lookups) {
        if (!meal) continue;
        const matchCount = matchCountById.get(idMeal) || 0;
        recipes.push(buildRecipePayload(meal, matchCount, fridgeNameSet));
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

        const lookups = await Promise.all(
          idsBatch.map(async (idMeal) => {
            try {
              const meal = await lookupMeal(idMeal);
              return { idMeal, meal };
            } catch (e) {
              console.error('TheMealDB lookup error:', idMeal, e?.message || e);
              return { idMeal, meal: null };
            }
          })
        );

        for (const { idMeal, meal } of lookups) {
          if (!meal || seenRecipeIds.has(idMeal)) continue;
          seenRecipeIds.add(idMeal);
          const matchCount = matchCountById.get(idMeal) || 0;
          const recipe = buildRecipePayload(meal, matchCount, fridgeNameSet);
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

    return res.status(200).json({
      status: 'OK',
      message,
      data: {
        recipes: limited,
        allowSubstitutions,
        filteredByMissing,
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
