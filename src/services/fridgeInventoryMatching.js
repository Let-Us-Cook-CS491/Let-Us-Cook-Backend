const MIN_TOKEN_LEN = 2;
const MAX_TOKENS_PER_NAME = 4;

const MATCHING_DISCLAIMER =
  'Some fridge item names were split into parts for matching; suggestions and matched ingredients may be partially or incorrectly associated with what you actually have.';

function normalizeFridgeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function fridgeNameToFilterIngredient(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function hasCompoundSeparators(normalizedLine) {
  if (!normalizedLine) return false;
  return /[&,\/]|\band\b/i.test(normalizedLine);
}

/**
 * Split compound fridge labels into ingredient-like tokens (normalized, single spaces).
 * @param {string} normalizedLine
 * @returns {string[]}
 */
function splitCompoundTokens(normalizedLine) {
  if (!normalizedLine) return [];
  const rough = normalizedLine
    .split(/[&,\/]/)
    .flatMap((part) => part.split(/\band\b/i))
    .map((p) => normalizeFridgeName(p))
    .filter((t) => t.length >= MIN_TOKEN_LEN);
  const out = [];
  const seen = new Set();
  for (const t of rough) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TOKENS_PER_NAME) break;
  }
  return out;
}

/**
 * @param {string} normalizedLine
 * @returns {{ filterKeys: string[], expanded: boolean, tokens: string[] }}
 */
function expandLineToFilterKeys(normalizedLine) {
  const baseKey = fridgeNameToFilterIngredient(normalizedLine);
  const keys = new Set([baseKey]);
  if (!hasCompoundSeparators(normalizedLine)) {
    return { filterKeys: [baseKey], expanded: false, tokens: [] };
  }
  const tokens = splitCompoundTokens(normalizedLine);
  if (tokens.length < 2) {
    return { filterKeys: [baseKey], expanded: false, tokens };
  }
  for (const t of tokens) {
    keys.add(fridgeNameToFilterIngredient(t));
  }
  return { filterKeys: [...keys], expanded: true, tokens };
}

/**
 * Build MealDB filter keys + fridge name set for overlap, including compound-line token expansion.
 * @param {Array<{ name?: string }>} fridgeItems sorted inventory rows (Mongo lean)
 * @param {number} maxFilterLines max distinct inventory names used for TheMealDB filter calls (e.g. maxIngredients)
 */
function buildFridgeMatchingFromInventory(fridgeItems, maxFilterLines) {
  const fridgeNameSet = new Set();
  const expandedInventoryDisplayNames = new Set();
  const globalFilterKeys = new Set();

  const orderedUniqueNormalized = [];
  const seenNorm = new Set();
  for (const item of fridgeItems) {
    const n = normalizeFridgeName(item?.name);
    if (!n) continue;
    fridgeNameSet.add(n);
    if (!seenNorm.has(n)) {
      seenNorm.add(n);
      orderedUniqueNormalized.push({ normalized: n, display: String(item.name || '').trim() || n });
    }
  }

  for (const { normalized, display } of orderedUniqueNormalized) {
    const { expanded, tokens } = expandLineToFilterKeys(normalized);
    if (expanded && tokens.length >= 2) {
      expandedInventoryDisplayNames.add(display);
      for (const t of tokens) {
        fridgeNameSet.add(t);
      }
    }
  }

  const linesForFilters = orderedUniqueNormalized.slice(0, Math.max(0, maxFilterLines));
  for (const { normalized } of linesForFilters) {
    const { filterKeys } = expandLineToFilterKeys(normalized);
    for (const k of filterKeys) {
      globalFilterKeys.add(k);
    }
  }

  const matchingHeuristicUsed = expandedInventoryDisplayNames.size > 0;
  const expandedInventoryNames = [...expandedInventoryDisplayNames];

  return {
    filterKeys: [...globalFilterKeys],
    fridgeNameSet,
    matchingHeuristicUsed,
    expandedInventoryNames,
    matchingDisclaimer: matchingHeuristicUsed ? MATCHING_DISCLAIMER : undefined,
  };
}

module.exports = {
  normalizeFridgeName,
  fridgeNameToFilterIngredient,
  buildFridgeMatchingFromInventory,
  MATCHING_DISCLAIMER,
};
