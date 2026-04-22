const db = require('../config/databaseConnection');
const { connectMongo } = require('../config/databaseConnection');
const FridgeItem = require('../schemes/fridgeItem');
const UserPreference = require('../schemes/userPreferences');
const { generateRecipesFromFridgeInventory } = require('./geminiFridgeRecipeGenerator');
const { resolveFridgeIdForUser } = require('./userFridgeResolver');
const { buildFridgeMatchingFromInventory, normalizeFridgeName } = require('./fridgeInventoryMatching');

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 15;
const DEFAULT_INCLUDE_REASONS = true;

function normalizeIngredient(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseRestrictionTerms(preferences) {
  const restrictions = Array.isArray(preferences?.restrictions) ? preferences.restrictions : [];
  const currentDiet = String(preferences?.current_diet || '').trim().toLowerCase();
  const terms = restrictions.map((x) => normalizeIngredient(x)).filter(Boolean);

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

function createPersonalizedMealService(deps = {}) {
  const loadMongo = deps.connectMongo || connectMongo;
  const readPreferences = deps.readPreferences || ((userId) => UserPreference.findOne({ user_id: userId }).lean());
  const readInventory =
    deps.readInventory ||
    (async (userId) => {
      const resolved = await resolveFridgeIdForUser(userId);
      if (resolved.status !== 'OK') {
        return [];
      }
      return FridgeItem.find({ fridge_id: resolved.fridgeId }, { name: 1, quantity: 1, unit: 1, category: 1 })
        .sort({ expiration_date: 1, name: 1 })
        .lean();
    });
  const readGoals = deps.readHealthGoals || readHealthGoals;
  const generateFromFridge = deps.generateRecipesFromFridgeInventory || generateRecipesFromFridgeInventory;

  async function getPersonalizedRecommendations({
    userId,
    limit = DEFAULT_LIMIT,
    maxMissingIngredients: _maxMissingIngredientsIgnored = 4,
    includeReasons = DEFAULT_INCLUDE_REASONS,
    cuisine = null,
    mealType = null,
    servings = null,
    maxMinutes = null,
  }) {
    await loadMongo();

    const [preferences, healthGoals, inventory] = await Promise.all([
      readPreferences(userId),
      readGoals(userId),
      readInventory(userId),
    ]);

    const allowSubstitutions = preferences?.allow_substitutions === true;
    const filteredByMissing = !allowSubstitutions;
    const substitutionMeta = { allowSubstitutions, filteredByMissing };

    const fridgeNames = [...new Set(inventory.map((item) => normalizeIngredient(item.name)).filter(Boolean))];
    if (!fridgeNames.length) {
      return {
        recommendations: [],
        meta: {
          strategy: 'none',
          source: 'generated',
          candidateCount: 0,
          generationMessage: 'Nothing could be generated.',
          ...substitutionMeta,
        },
      };
    }

    const uniqueNameCount = new Set(
      inventory.map((item) => normalizeFridgeName(item?.name)).filter(Boolean)
    ).size;
    const inventoryMatching = buildFridgeMatchingFromInventory(inventory, uniqueNameCount);

    const matchingMeta = {
      matchingHeuristicUsed: inventoryMatching.matchingHeuristicUsed,
      matchingDisclaimer: inventoryMatching.matchingDisclaimer,
      expandedInventoryNames: inventoryMatching.expandedInventoryNames,
      ...substitutionMeta,
      source: 'generated',
    };

    const fridgeItems = inventory
      .map((row) => ({
        name: normalizeIngredient(row.name),
        quantity: row.quantity != null ? Number(row.quantity) : undefined,
        unit: row.unit ? String(row.unit).trim() : undefined,
        category: row.category ? String(row.category).trim() : undefined,
      }))
      .filter((x) => x.name);

    const profile = {
      currentDiet: preferences?.current_diet || 'Everything',
      restrictions: preferences?.restrictions || [],
      allowSubstitutions,
      healthGoal: healthGoals?.goal ?? null,
      activityLevel: healthGoals?.activity_level ?? null,
      calorieTarget: healthGoals?.calorie_target ?? null,
      cuisine: cuisine || null,
      mealType: mealType || null,
      servings: servings != null && Number.isFinite(servings) ? servings : null,
      maxPrepMinutes: maxMinutes != null && Number.isFinite(maxMinutes) ? maxMinutes : null,
    };

    const maxRecipes = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    let genResult;
    try {
      genResult = await generateFromFridge({
        fridgeItems,
        profile,
        maxRecipes,
        includeReasons,
      });
    } catch (err) {
      console.error('generateRecipesFromFridgeInventory error:', err?.message || err);
      genResult = { recipes: [], error: err?.message || 'generation_failed' };
    }

    let recipes = Array.isArray(genResult?.recipes) ? genResult.recipes : [];

    const restrictionTerms = parseRestrictionTerms(preferences);
    if (restrictionTerms.length && recipes.length) {
      recipes = recipes.filter((r) => {
        const names = [
          ...(Array.isArray(r.ingredients) ? r.ingredients.map((i) => normalizeIngredient(i?.name)) : []),
          ...(Array.isArray(r.usedFromFridge) ? r.usedFromFridge.map((n) => normalizeIngredient(n)) : []),
        ].filter(Boolean);
        return !violatesRestrictions(names, restrictionTerms);
      });
    }

    if (!recipes.length) {
      return {
        recommendations: [],
        meta: {
          strategy: 'none',
          candidateCount: 0,
          generationMessage: 'Nothing could be generated.',
          ...matchingMeta,
        },
      };
    }

    return {
      recommendations: recipes,
      meta: {
        strategy: 'generated',
        candidateCount: recipes.length,
        ...matchingMeta,
      },
    };
  }

  return {
    getPersonalizedRecommendations,
  };
}

module.exports = {
  createPersonalizedMealService,
  getPersonalizedRecommendations: createPersonalizedMealService().getPersonalizedRecommendations,
  readHealthGoals,
  __private: {
    parseRestrictionTerms,
    violatesRestrictions,
  },
};
