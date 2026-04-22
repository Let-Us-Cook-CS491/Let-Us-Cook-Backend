/**
 * Empty arrays are dropped unless the key is semantically meaningful (e.g. ingredient lists).
 */
const KEEP_EMPTY_ARRAY_KEYS = new Set([
  'recommendations',
  'recipes',
  'recipeIngredients',
  'matchedIngredients',
  'missingIngredients',
  'expandedInventoryNames',
  'excludedIngredients',
  'restrictionTerms',
]);

/**
 * Deep-remove null, undefined, blank strings, empty objects, and (most) empty arrays
 * so API responses stay small. Preserves false and 0.
 * @param {*} value
 * @param {boolean} [isRoot]
 * @returns {*}
 */
function compactForJson(value, isRoot = true) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
  if (typeof value === 'string') {
    return value.trim() === '' ? undefined : value;
  }
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item) => compactForJson(item, false)).filter((item) => item !== undefined);
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    const child = typeof v === 'object' && v !== null ? compactForJson(v, false) : v;
    if (child === undefined) continue;
    if (typeof child === 'object' && !Array.isArray(child) && Object.keys(child).length === 0) continue;
    if (Array.isArray(child) && child.length === 0 && !KEEP_EMPTY_ARRAY_KEYS.has(k)) continue;
    out[k] = child;
  }

  if (!Object.keys(out).length) {
    return isRoot ? {} : undefined;
  }
  return out;
}

module.exports = { compactForJson };
