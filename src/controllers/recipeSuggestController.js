const personalizedMealService = require('../services/personalizedMealService');
const { runSuggestFromFridge } = require('../services/fridgeRecipeSuggestService');
const { browseRecipes: browseRecipesService } = require('../services/recipeFilterService');
const { compactForJson } = require('../utils/compactForJson');

function parsePositiveInt(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return fallback;
}

/** Optional query string; null means omit. */
function parseOptionalTrimmedString(value, maxLen) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

/** Number of people to cook for; null if omitted or invalid. */
function parseServings(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(Math.floor(n), 50);
}

/** Max prep + cook time in minutes; null if omitted or invalid. */
function parseMaxMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(Math.floor(n), 480);
}

exports.suggestRecipesFromFridge = async (req, res) => {
  try {
    const rawUserId = req.user?.user_id;
    const user_id = Number(rawUserId);
    if (!Number.isInteger(user_id)) {
      return res.status(401).json({
        status: 'ERROR',
        message: 'Unauthorized',
      });
    }

    const result = await runSuggestFromFridge({
      userId: user_id,
      limit: req.query?.limit,
      maxIngredients: req.query?.maxIngredients,
    });

    if (result.kind === 'error') {
      return res.status(result.status).json(result.body);
    }

    if (result.body?.data) {
      const data = compactForJson(result.body.data) || {};
      if (!('recipes' in data)) data.recipes = [];
      return res.status(result.status).json({
        ...result.body,
        data,
      });
    }

    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('suggestRecipesFromFridge error:', err);
    return res.status(500).json({
      status: 'ERROR',
      message: 'Failed to suggest recipes',
    });
  }
};

exports.getPersonalizedRecommendations = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    if (!Number.isInteger(user_id)) {
      return res.status(401).json({
        status: 'ERROR',
        message: 'Unauthorized',
      });
    }

    const limit = parsePositiveInt(req.query?.limit, 5, 15);
    const maxMissingIngredients = parsePositiveInt(req.query?.maxMissingIngredients, 4, 10);
    const includeReasons = parseBoolean(req.query?.includeReasons, true);
    const cuisine = parseOptionalTrimmedString(req.query?.cuisine, 64);
    const mealType = parseOptionalTrimmedString(req.query?.mealType, 48);
    const servings = parseServings(req.query?.servings);
    const maxMinutes = parseMaxMinutes(req.query?.maxMinutes);

    const result = await personalizedMealService.getPersonalizedRecommendations({
      userId: user_id,
      limit,
      maxMissingIngredients,
      includeReasons,
      cuisine,
      mealType,
      servings,
      maxMinutes,
    });

    const meta = result.meta || {};
    const filters = {};
    if (cuisine) filters.cuisine = cuisine;
    if (mealType) filters.mealType = mealType;
    if (servings != null) filters.servings = servings;
    if (maxMinutes != null) filters.maxMinutes = maxMinutes;

    const data = {
      recommendations: result.recommendations,
      strategy: meta.strategy || 'unknown',
      candidateCount: meta.candidateCount ?? 0,
      allowSubstitutions: meta.allowSubstitutions === true,
      filteredByMissing: meta.filteredByMissing === true,
    };
    if (Object.keys(filters).length) {
      data.filters = filters;
    }
    if (meta.matchingHeuristicUsed) {
      data.matchingHeuristicUsed = true;
      data.matchingDisclaimer = meta.matchingDisclaimer;
      data.expandedInventoryNames = meta.expandedInventoryNames;
    }
    if (meta.fridgeIngredientFallback === true) {
      data.fridgeIngredientFallback = true;
      if (meta.relaxedMaxMissingIngredients != null) {
        data.relaxedMaxMissingIngredients = meta.relaxedMaxMissingIngredients;
      }
    }
    if (meta.sessionFilterRelaxed === true) {
      data.sessionFilterRelaxed = true;
    }

    const compacted = compactForJson(data) || {};
    if (!('recommendations' in compacted)) compacted.recommendations = [];

    const okMessage =
      Array.isArray(result.recommendations) && result.recommendations.length > 0
        ? 'Personalized meal recommendations generated'
        : meta.generationMessage || 'Nothing could be generated.';

    return res.status(200).json({
      status: 'OK',
      message: okMessage,
      data: compacted,
    });
  } catch (err) {
    console.error('getPersonalizedRecommendations error:', err);
    return res.status(500).json({
      status: 'ERROR',
      message: 'Failed to generate personalized recommendations',
    });
  }
};

exports.browseRecipes = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    if (!Number.isInteger(user_id)) {
      return res.status(401).json({
        status: 'ERROR',
        message: 'Unauthorized',
      });
    }

    // Parse query parameters
    const limit = parsePositiveInt(req.query?.limit, 20, 50);
    const skip = Math.max(Number(req.query?.skip) || 0, 0);
    const sortBy = req.query?.sortBy;
    const searchText = req.query?.searchText;
    const diet = req.query?.diet;

    // Parse excludeIngredients - can be single value or array
    let excludeIngredients = [];
    if (req.query?.excludeIngredients) {
      if (Array.isArray(req.query.excludeIngredients)) {
        excludeIngredients = req.query.excludeIngredients;
      } else {
        excludeIngredients = [req.query.excludeIngredients];
      }
    }

    const result = await browseRecipesService(user_id, {
      limit,
      skip,
      sortBy,
      searchText,
      diet,
      excludeIngredients,
    });

    if (!result.ok) {
      return res.status(500).json({
        status: 'ERROR',
        message: 'Failed to browse recipes',
      });
    }

    const meta = result.meta || {};
    const browseData = {
      recipes: result.recipes,
      pagination: {
        total: meta.total,
        returned: meta.returned,
        skip: meta.skip,
        limit: meta.limit,
        hasMore: meta.hasMore,
      },
      filters: {
        appliedDiet: meta.appliedDiet,
        excludedIngredients: meta.excludedIngredients,
        restrictionTerms: meta.restrictionTerms,
      },
    };

    const browseCompact = compactForJson(browseData) || {};
    if (!('recipes' in browseCompact)) browseCompact.recipes = [];

    return res.status(200).json({
      status: 'OK',
      message: 'Recipes retrieved',
      data: browseCompact,
    });
  } catch (err) {
    console.error('browseRecipes error:', err);
    return res.status(500).json({
      status: 'ERROR',
      message: 'Failed to browse recipes',
    });
  }
};
