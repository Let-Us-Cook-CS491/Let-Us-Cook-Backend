const test = require('node:test');
const assert = require('node:assert/strict');

const { startOfUtcWeekMonday, normalizeSlotName } = require('../weeklyMealPlanService');

test('startOfUtcWeekMonday normalizes to Sunday start', () => {
  const mondayInput = '2026-04-20T12:00:00.000Z';
  const normalized = startOfUtcWeekMonday(mondayInput);
  assert.equal(normalized.toISOString(), '2026-04-19T00:00:00.000Z');
});

test('normalizeSlotName only accepts canonical slot names', () => {
  assert.equal(normalizeSlotName('breakfast'), 'breakfast');
  assert.equal(normalizeSlotName('lunch'), 'lunch');
  assert.equal(normalizeSlotName('dinner'), 'dinner');
  assert.equal(normalizeSlotName('morning'), null);
  assert.equal(normalizeSlotName('afternoon'), null);
});
