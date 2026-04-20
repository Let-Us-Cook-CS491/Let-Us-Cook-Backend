const personalizedMealService = require('../services/personalizedMealService');
const { runSuggestFromFridge } = require('../services/fridgeRecipeSuggestService');
const { browseRecipes: browseRecipesService } = require('../services/recipeFilterService');

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

    const result = await personalizedMealService.getPersonalizedRecommendations({
      userId: user_id,
      limit,
      maxMissingIngredients,
      includeReasons,
    });

    const meta = result.meta || {};
    const data = {
      recommendations: result.recommendations,
      strategy: meta.strategy || 'unknown',
      candidateCount: meta.candidateCount ?? 0,
      allowSubstitutions: meta.allowSubstitutions === true,
      filteredByMissing: meta.filteredByMissing === true,
    };
    if (meta.matchingHeuristicUsed) {
      data.matchingHeuristicUsed = true;
      data.matchingDisclaimer = meta.matchingDisclaimer;
      data.expandedInventoryNames = meta.expandedInventoryNames;
    }

    return res.status(200).json({
      status: 'OK',
      message: 'Personalized meal recommendations generated',
      data,
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
    return res.status(200).json({
      status: 'OK',
      message: 'Recipes retrieved',
      data: {
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
      },
    });
  } catch (err) {
    console.error('browseRecipes error:', err);
    return res.status(500).json({
      status: 'ERROR',
      message: 'Failed to browse recipes',
    });
  }
};
