const Recipie = require('../schemes/recipie');
const { lookupMeal } = require('./theMealDbClient');

/**
 * Load MealDB-shaped meals from Recipies cache (mealdb_full) keyed by idMeal.
 * @param {string[]} idMeals
 * @returns {Promise<Map<string, object>>}
 */
async function readCachedMealsByIdMeal(idMeals) {
  const ids = [...new Set(idMeals.map((id) => String(id || '')).filter(Boolean))];
  if (!ids.length) return new Map();

  const docs = await Recipie.find({ idMeal: { $in: ids } }, { idMeal: 1, mealdb_full: 1 }).lean();
  const map = new Map();
  for (const d of docs) {
    const id = d.idMeal != null ? String(d.idMeal) : '';
    const full = d.mealdb_full;
    if (!id || !full || typeof full !== 'object') continue;
    if (!full.idMeal) continue;
    map.set(id, full);
  }
  return map;
}

/**
 * Persist full TheMealDB lookup payload for future Mongo-first reads (RMG 1.1 cache).
 * @param {object} meal
 */
async function upsertMealdbRecipeCache(meal) {
  if (!meal?.idMeal) return;
  const idMeal = String(meal.idMeal);
  await Recipie.findOneAndUpdate(
    { idMeal },
    {
      $set: {
        idMeal,
        title: meal.strMeal || 'Recipe',
        image_url: meal.strMealThumb || '',
        mealdb_full: meal,
        recipe_source: 'mealdb',
      },
    },
    { upsert: true }
  );
}

/**
 * For each idMeal (same order as input), return the full meal object TheMealDB would return,
 * preferring Mongo `Recipies` when `mealdb_full` exists; otherwise fetch from TheMealDB and upsert.
 * @param {string[]} idMeals
 * @returns {Promise<(object|null)[]>}
 */
async function lookupMealsMongoFirst(idMeals) {
  const ids = idMeals.map((id) => String(id || ''));
  if (!ids.length) return [];

  const fromMongo = await readCachedMealsByIdMeal(ids);
  const needFetch = [...new Set(ids.filter((id) => id && !fromMongo.has(id)))];

  const fetched = new Map();
  await Promise.all(
    needFetch.map(async (id) => {
      try {
        const meal = await lookupMeal(id);
        if (meal) {
          try {
            await upsertMealdbRecipeCache(meal);
          } catch (err) {
            console.error('MealDB recipe cache upsert failed:', id, err?.message || err);
          }
          fetched.set(id, meal);
        }
      } catch (err) {
        console.error('TheMealDB lookup error:', id, err?.message || err);
      }
    })
  );

  return ids.map((id) => (id ? fromMongo.get(id) || fetched.get(id) || null : null));
}

module.exports = {
  readCachedMealsByIdMeal,
  upsertMealdbRecipeCache,
  lookupMealsMongoFirst,
};
