const Macro = require('../schemes/macros');

const ZERO_TOTALS = Object.freeze({
  calories_kcal: 0,
  protein_g: 0,
  fat_g: 0,
  carbohydrates_g: 0,
  fiber_g: 0,
});

const NUTRITION_BASIS =
  'Each ingredient is matched to the MongoDB Macros collection by normalized mealdb_name. Values are taken from nutrition_values_per_100g (nutrients per 100 g). Recipe totals are the sum of those matched macro rows for each distinct ingredient name in the recipe; repeated ingredient lines only contribute once. MealDB strMeasure fields are not parsed and amounts are not converted to grams, so totals are not portion-accurate for the prepared dish—they are a relative breakdown for comparison across recipes.';

const NUTRITION_DISCLAIMER =
  'Totals are unscaled sums of per-100g ingredient macros and do not reflect recipe quantities or serving sizes.';

function normalizeIngredientName(raw) {
  if (raw == null || typeof raw !== 'string') return '';
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return s || '';
}

function cleanNumber(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function addNutritionValues(totals, vals) {
  if (!vals || typeof vals !== 'object') return;
  totals.calories_kcal += cleanNumber(vals.calories_kcal);
  totals.protein_g += cleanNumber(vals.protein_g);
  totals.fat_g += cleanNumber(vals.fat_g);
  totals.carbohydrates_g += cleanNumber(vals.carbohydrates_g);
  totals.fiber_g += cleanNumber(vals.fiber_g);
}

function snapshotNutritionValues(vals) {
  if (!vals || typeof vals !== 'object') {
    return { ...ZERO_TOTALS };
  }
  return {
    calories_kcal: cleanNumber(vals.calories_kcal),
    protein_g: cleanNumber(vals.protein_g),
    fat_g: cleanNumber(vals.fat_g),
    carbohydrates_g: cleanNumber(vals.carbohydrates_g),
    fiber_g: cleanNumber(vals.fiber_g),
  };
}

/**
 * Loads all Macro documents for this request and builds a lookup map by normalized mealdb_name.
 * First occurrence wins if duplicates exist in the collection.
 */
async function loadMacrosLookupMap() {
  const docs = await Macro.find({}, { mealdb_name: 1, nutrition_values_per_100g: 1, _id: 0 }).lean();
  const map = new Map();
  for (const d of docs) {
    const key = normalizeIngredientName(d.mealdb_name);
    if (!key || map.has(key)) continue;
    map.set(key, d.nutrition_values_per_100g || {});
  }
  return map;
}

/**
 * @param {object} meal TheMealDB meal (strIngredient1..20, strMeasure1..20)
 * @param {Map<string, object>} macroMap normalized mealdb_name -> nutrition_values_per_100g
 */
function buildRecipeNutritionFromMeal(meal, macroMap) {
  const map = macroMap instanceof Map ? macroMap : new Map();
  const totals = {
    calories_kcal: 0,
    protein_g: 0,
    fat_g: 0,
    carbohydrates_g: 0,
    fiber_g: 0,
  };
  const ingredientRows = [];
  const matchedIngredients = [];
  const matchedKeys = new Set();
  const seenForTotals = new Set();
  const uniqueRecipeIngredients = new Set();

  for (let i = 1; i <= 20; i += 1) {
    const rawIng = meal[`strIngredient${i}`];
    const rawMeasure = meal[`strMeasure${i}`];
    const strIngredient = rawIng == null ? '' : String(rawIng).trim();
    const strMeasure = rawMeasure == null ? '' : String(rawMeasure).trim();
    const norm = normalizeIngredientName(rawIng);

    if (!norm) {
      ingredientRows.push({
        index: i,
        strIngredient,
        strMeasure,
        matchedMealdbName: null,
        values: null,
        countedInTotals: false,
      });
      continue;
    }

    uniqueRecipeIngredients.add(norm);
    const values = map.get(norm);
    const hasMatch = values !== undefined;

    let countedInTotals = false;
    if (hasMatch && !seenForTotals.has(norm)) {
      seenForTotals.add(norm);
      addNutritionValues(totals, values);
      countedInTotals = true;
      if (!matchedKeys.has(norm)) {
        matchedKeys.add(norm);
        matchedIngredients.push({
          normalizedIngredient: norm,
          mealdb_name: norm,
          nutrition_values_per_100g: snapshotNutritionValues(values),
        });
      }
    }

    ingredientRows.push({
      index: i,
      strIngredient,
      strMeasure,
      matchedMealdbName: hasMatch ? norm : null,
      values: hasMatch ? snapshotNutritionValues(values) : null,
      countedInTotals,
    });
  }

  const totalIngredients = uniqueRecipeIngredients.size;
  const matchedCount = matchedKeys.size;
  const coveragePercent =
    totalIngredients === 0 ? 0 : Math.round((100 * matchedCount) / totalIngredients);

  return {
    totals,
    coverage: {
      matchedIngredients: matchedCount,
      totalIngredients,
      coveragePercent,
    },
    matchedIngredients,
    basis: NUTRITION_BASIS,
    disclaimer: NUTRITION_DISCLAIMER,
    ingredientRows,
  };
}

module.exports = {
  normalizeIngredientName,
  loadMacrosLookupMap,
  buildRecipeNutritionFromMeal,
  NUTRITION_BASIS,
  NUTRITION_DISCLAIMER,
};
