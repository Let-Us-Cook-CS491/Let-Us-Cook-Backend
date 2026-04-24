const test = require('node:test');
const assert = require('node:assert/strict');

const mealPlanController = require('../mealPlanController');
const weeklyMealPlanService = require('../../services/weeklyMealPlanService');

function createMockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

const originalAddSelectedRecipeToSlot = weeklyMealPlanService.addSelectedRecipeToSlot;

test.after(() => {
  weeklyMealPlanService.addSelectedRecipeToSlot = originalAddSelectedRecipeToSlot;
});

test('postWeekSlotFromRecipe returns 401 without authenticated user', async () => {
  const req = { user: null, body: {} };
  const res = createMockRes();

  await mealPlanController.postWeekSlotFromRecipe(req, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, { status: 'ERROR', message: 'Unauthorized' });
});

test('postWeekSlotFromRecipe returns 200 when slot update succeeds', async () => {
  weeklyMealPlanService.addSelectedRecipeToSlot = async () => ({
    ok: true,
    plan: { week_start: '2026-04-19T00:00:00.000Z', days: [] },
  });

  const req = {
    user: { user_id: 42 },
    body: {
      weekStart: '2026-04-19',
      date: '2026-04-23',
      slot: 'breakfast',
      recipe: {
        source: 'mealdb',
        idMeal: '52772',
        strMeal: 'Teriyaki Chicken Casserole',
      },
    },
  };
  const res = createMockRes();

  await mealPlanController.postWeekSlotFromRecipe(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'OK');
  assert.equal(res.payload.message, 'Recipe added to meal plan slot');
});

test('postWeekSlotFromRecipe passes through service validation errors', async () => {
  weeklyMealPlanService.addSelectedRecipeToSlot = async () => ({
    ok: false,
    status: 400,
    message: 'slot must be breakfast, lunch, or dinner',
  });

  const req = {
    user: { user_id: 42 },
    body: {
      weekStart: '2026-04-19',
      date: '2026-04-23',
      slot: 'midnight',
      recipe: { source: 'mealdb', idMeal: '52772' },
    },
  };
  const res = createMockRes();

  await mealPlanController.postWeekSlotFromRecipe(req, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { status: 'ERROR', message: 'slot must be breakfast, lunch, or dinner' });
});
