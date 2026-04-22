const weeklyMealPlanService = require('../services/weeklyMealPlanService');
const { rebalanceWeekPlanForCalories } = require('../services/mealPlanCalorieRebalanceService');

function parseQueryBool(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const s = String(value).trim().toLowerCase();
  if (s === 'false' || s === '0' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'yes') return true;
  return defaultValue;
}

function parseUserId(req) {
  const user_id = Number(req.user?.user_id);
  if (!Number.isInteger(user_id)) {
    return null;
  }
  return user_id;
}

function validateFilledSlot(slotData) {
  if (slotData == null) return { ok: true };
  if (typeof slotData !== 'object' || Array.isArray(slotData)) {
    return { ok: false, message: 'slotData must be an object or null' };
  }
  const source = String(slotData.source || '');
  if (source !== 'mongo' && source !== 'mealdb') {
    return { ok: false, message: 'slotData.source must be mongo or mealdb' };
  }
  if (!slotData.title || typeof slotData.title !== 'string') {
    return { ok: false, message: 'slotData.title is required' };
  }
  if (source === 'mongo' && !slotData.recipe_id) {
    return { ok: false, message: 'slotData.recipe_id is required when source is mongo' };
  }
  if (source === 'mealdb' && !slotData.idMeal) {
    return { ok: false, message: 'slotData.idMeal is required when source is mealdb' };
  }
  return { ok: true };
}

exports.getWeekPlan = async (req, res) => {
  try {
    const user_id = parseUserId(req);
    if (!user_id) {
      return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
    }

    const weekStart = req.query?.weekStart;
    if (weekStart == null || weekStart === '') {
      return res.status(400).json({ status: 'ERROR', message: 'weekStart query parameter is required' });
    }
    const createIfMissing = parseQueryBool(req.query?.createIfMissing, true);
    const result = await weeklyMealPlanService.getWeekPlan(user_id, weekStart, { createIfMissing });
    if (!result.ok) {
      return res.status(result.status).json({ status: 'ERROR', message: result.message });
    }

    return res.status(200).json({
      status: 'OK',
      message: result.plan ? 'Weekly meal plan' : 'No meal plan for this week',
      data: { plan: result.plan },
    });
  } catch (err) {
    console.error('getWeekPlan error:', err);
    return res.status(500).json({ status: 'ERROR', message: 'Failed to load meal plan' });
  }
};

exports.listWeekPlans = async (req, res) => {
  try {
    const user_id = parseUserId(req);
    if (!user_id) {
      return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
    }

    const result = await weeklyMealPlanService.listWeekPlans(user_id, req.query || {});
    if (!result.ok) {
      return res.status(500).json({ status: 'ERROR', message: 'Failed to list meal plans' });
    }

    return res.status(200).json({
      status: 'OK',
      message: 'Saved meal plan weeks',
      data: { weeks: result.weeks },
    });
  } catch (err) {
    console.error('listWeekPlans error:', err);
    return res.status(500).json({ status: 'ERROR', message: 'Failed to list meal plans' });
  }
};

exports.postWeekPlan = async (req, res) => {
  try {
    const user_id = parseUserId(req);
    if (!user_id) {
      return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
    }

    const body = req.body || {};
    if (body.weekStart == null || body.weekStart === '') {
      return res.status(400).json({ status: 'ERROR', message: 'weekStart is required in the request body' });
    }

    const result = await weeklyMealPlanService.generateWeekPlan(user_id, body);
    if (!result.ok) {
      return res.status(result.status).json({ status: 'ERROR', message: result.message });
    }

    let meta = result.meta || {};
    let plan = result.plan;
    let message = 'Weekly meal plan generated';
    if (meta.poolSize === 0) {
      message = body.replace
        ? 'No recipe candidates available; all slots were cleared because replace was requested'
        : 'No recipe candidates available; meal plan was not changed';
    }

    // If adjustCalories flag is set, run rebalance immediately
    if (body.adjustCalories === true) {
      try {
        const rebalanceResult = await rebalanceWeekPlanForCalories(user_id, body);
        if (rebalanceResult.ok && rebalanceResult.plan) {
          plan = rebalanceResult.plan;
          meta = { ...meta, ...rebalanceResult.meta };
          message = 'Weekly meal plan generated and calorie-adjusted';
        }
      } catch (rebalanceErr) {
        console.error('postWeekPlan rebalance error:', rebalanceErr);
        // Continue with non-rebalanced plan
      }
    }

    return res.status(200).json({
      status: 'OK',
      message,
      data: { plan, meta },
    });
  } catch (err) {
    console.error('postWeekPlan error:', err);
    return res.status(500).json({ status: 'ERROR', message: 'Failed to generate meal plan' });
  }
};

exports.patchWeekSlot = async (req, res) => {
  try {
    const user_id = parseUserId(req);
    if (!user_id) {
      return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
    }

    const body = req.body || {};
    if (!Object.prototype.hasOwnProperty.call(body, 'slotData')) {
      return res.status(400).json({ status: 'ERROR', message: 'slotData is required (use null to clear)' });
    }
    if (body.slotData != null) {
      const check = validateFilledSlot(body.slotData);
      if (!check.ok) {
        return res.status(400).json({ status: 'ERROR', message: check.message });
      }
    }

    const result = await weeklyMealPlanService.patchWeekSlot(user_id, body);
    if (!result.ok) {
      return res.status(result.status).json({ status: 'ERROR', message: result.message });
    }

    return res.status(200).json({
      status: 'OK',
      message: 'Slot updated',
      data: { plan: result.plan },
    });
  } catch (err) {
    console.error('patchWeekSlot error:', err);
    return res.status(500).json({ status: 'ERROR', message: 'Failed to update slot' });
  }
};

exports.postWeekRebalance = async (req, res) => {
  try {
    const user_id = parseUserId(req);
    if (!user_id) {
      return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
    }

    const body = req.body || {};
    if (body.weekStart == null || body.weekStart === '') {
      return res.status(400).json({ status: 'ERROR', message: 'weekStart is required in the request body' });
    }

    const result = await rebalanceWeekPlanForCalories(user_id, body);
    if (!result.ok) {
      return res.status(result.status || 500).json({ status: 'ERROR', message: result.message || 'Rebalance failed' });
    }

    const meta = result.meta || {};
    let message = 'Meal plan calorie-rebalanced';
    if (meta.skipped_reason) {
      message = `Rebalance skipped: ${meta.skipped_reason}`;
    }

    return res.status(200).json({
      status: 'OK',
      message,
      data: { plan: result.plan, meta },
    });
  } catch (err) {
    console.error('postWeekRebalance error:', err);
    return res.status(500).json({ status: 'ERROR', message: 'Failed to rebalance meal plan' });
  }
};
