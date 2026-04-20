const { connectMongo } = require('../config/databaseConnection');
const Recipie = require('../schemes/recipie');
const UserPreference = require('../schemes/userPreferences');

// Import helper functions from personalizedMealService
const {
    __private: { parseRestrictionTerms, violatesRestrictions },
} = require('./personalizedMealService');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DEFAULT_SKIP = 0;
const DEFAULT_SORT = 'title';

/**
 * Normalize ingredient string for comparison.
 */
function normalizeIngredient(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

/**
 * Extract normalized ingredients from a recipe document.
 */
function extractRecipeIngredients(recipe) {
    const ingredients = [];

    // Try mealdb_full structure first (cached MealDB recipes)
    if (recipe.mealdb_full && typeof recipe.mealdb_full === 'object') {
        for (let i = 1; i <= 20; i += 1) {
            const ing = normalizeIngredient(recipe.mealdb_full[`strIngredient${i}`]);
            if (ing) ingredients.push(ing);
        }
    }

    // Try ingredients array (native recipes)
    if (Array.isArray(recipe.ingredients)) {
        for (const item of recipe.ingredients) {
            const ing = normalizeIngredient(item?.name);
            if (ing) ingredients.push(ing);
        }
    }

    return [...new Set(ingredients)];
}

/**
 * Browse recipes from Mongo with dietary filtering.
 */
async function browseRecipes(userId, options = {}) {
    await connectMongo();

    // Parse options
    const limit = Math.min(Math.max(Number(options.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const skip = Math.max(Number(options.skip) || DEFAULT_SKIP, 0);
    const sortBy = options.sortBy === 'createdAt' ? 'createdAt' : DEFAULT_SORT;
    const searchText = options.searchText ? String(options.searchText).trim() : null;
    const overrideDiet = options.diet ? String(options.diet).trim() : null;
    const excludeIngredients = Array.isArray(options.excludeIngredients)
        ? options.excludeIngredients.map((x) => normalizeIngredient(x)).filter(Boolean)
        : [];

    // Load user preferences
    const preferences = await UserPreference.findOne({ user_id: userId }).lean();

    // Build restriction terms
    let restrictionTerms = [];
    if (overrideDiet || preferences) {
        const effectivePrefs = overrideDiet
            ? { ...preferences, current_diet: overrideDiet }
            : preferences;
        restrictionTerms = parseRestrictionTerms(effectivePrefs || {});
    }

    // Merge with excludeIngredients param
    restrictionTerms = [...new Set([...restrictionTerms, ...excludeIngredients])];

    // Build query
    const query = {};
    if (searchText) {
        query.title = { $regex: searchText, $options: 'i' };
    }

    // Get total count
    const total = await Recipie.countDocuments(query);

    // Fetch recipes with pagination
    const sortOrder = sortBy === 'createdAt' ? { createdAt: -1 } : { title: 1 };
    const recipes = await Recipie.find(query)
        .sort(sortOrder)
        .skip(skip)
        .limit(limit)
        .lean();

    // Filter by dietary restrictions
    const filtered = [];
    for (const recipe of recipes) {
        const recipeIngredients = extractRecipeIngredients(recipe);
        if (!violatesRestrictions(recipeIngredients, restrictionTerms)) {
            filtered.push({
                _id: recipe._id,
                title: recipe.title,
                image_url: recipe.image_url || recipe.strMealThumb || '',
                ingredients: recipeIngredients,
                nutrition: recipe.nutrition || {},
                tags: recipe.tags || [],
                recipe_source: recipe.recipe_source,
                createdAt: recipe.createdAt,
            });
        }
    }

    return {
        ok: true,
        recipes: filtered,
        meta: {
            total,
            returned: filtered.length,
            skip,
            limit,
            hasMore: skip + filtered.length < total,
            appliedDiet: overrideDiet || preferences?.current_diet || 'Everything',
            excludedIngredients: excludeIngredients,
            restrictionTerms,
        },
    };
}

module.exports = {
    browseRecipes,
};
