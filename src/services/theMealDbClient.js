const DEFAULT_BASE_URL = 'https://www.themealdb.com/api/json/v1';
const DEFAULT_API_KEY = '1';
const REQUEST_TIMEOUT_MS = 10_000;

function getConfig() {
  const baseUrl = String(process.env.THEMEALDB_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/$/,
    ''
  );
  const apiKey = String(process.env.THEMEALDB_API_KEY || DEFAULT_API_KEY);
  return { baseUrl, apiKey };
}

function buildEndpointUrl(filename, queryParams) {
  const { baseUrl, apiKey } = getConfig();
  const url = new URL(`${baseUrl}/${apiKey}/${filename}`);
  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * @param {string} ingredient Main ingredient for filter.php (e.g. chicken_breast)
 * @returns {Promise<{ meals: Array<{ idMeal: string, strMeal: string, strMealThumb: string }> | null }>}
 */
async function filterByMainIngredient(ingredient) {
  const url = buildEndpointUrl('filter.php', { i: ingredient });
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`TheMealDB filter request failed: ${res.status}`);
  }
  return res.json();
}

/**
 * @param {string} idMeal
 * @returns {Promise<object | null>} Full meal object or null if not found
 */
async function lookupMeal(idMeal) {
  const url = buildEndpointUrl('lookup.php', { i: idMeal });
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`TheMealDB lookup request failed: ${res.status}`);
  }
  const data = await res.json();
  const meal = data?.meals?.[0];
  return meal ?? null;
}

module.exports = {
  filterByMainIngredient,
  lookupMeal,
};
