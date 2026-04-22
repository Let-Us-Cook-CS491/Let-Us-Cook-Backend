const https = require('https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_FRIDGE_RECIPE_MODEL =
  process.env.GEMINI_FRIDGE_RECIPE_MODEL ||
  process.env.GEMINI_RECOMMENDER_MODEL ||
  process.env.GEMINI_MODEL ||
  'gemini-2.5-flash';
const GEMINI_FRIDGE_RECIPE_TEMPERATURE = Number(process.env.GEMINI_FRIDGE_RECIPE_TEMPERATURE ?? 0.45);
const GEMINI_FRIDGE_RECIPE_MAX_TOKENS = Number(process.env.GEMINI_FRIDGE_RECIPE_MAX_TOKENS ?? 4096);

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);

    const req = https.request(
      {
        method: 'POST',
        hostname: urlObj.hostname,
        path: `${urlObj.pathname}${urlObj.search}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`Gemini API error: ${res.statusCode} ${raw.slice(0, 500)}`));
          }
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            reject(new Error('Failed to parse Gemini response JSON'));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sanitizeJsonText(raw) {
  let text = String(raw || '').trim();
  text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1).trim();
  }
  return text;
}

function buildPrompt({ fridgeItemsJson, profile, maxRecipes }) {
  return `
You are a home cooking assistant. Build practical recipe(s) centered on the user's FRIDGE_ITEMS_JSON list.

INGREDIENT POLICY:
- Main foods must come from FRIDGE_ITEMS_JSON (match names closely).
- Small "wiggle room" is allowed: you may also use modest amounts of common pantry items that are often already at home, even if missing from the list—only when needed for basic technique or flavor. Examples: salt, black pepper, neutral cooking oil, sugar, butter (unless diet forbids), all-purpose flour, cornstarch, baking powder, soy sauce, vinegar or lemon juice, garlic powder, dried herbs/spices (e.g. oregano, cumin). Do not add large or expensive extras (no cream, wine, specialty produce, meat, or fish unless on the list). Prefer fewer pantry add-ons; skip them if the fridge list is enough.
- Assume tap water and cooking heat exist.
- Put fridge-based items in "ingredients" and "usedFromFridge". Put any pantry wiggle-room items in "optionalPantry" (name + optional short purpose), not in usedFromFridge.

If you cannot produce at least one coherent recipe, return exactly: {"recipes":[]}

USER_PROFILE_JSON:
${JSON.stringify(profile)}

FRIDGE_ITEMS_JSON:
${fridgeItemsJson}

RULES:
- Output strict JSON only (no markdown).
- At most ${maxRecipes} objects in "recipes".
- Respect diet restrictions and allergies in USER_PROFILE_JSON; if impossible, return {"recipes":[]}.
- Honor cuisine, mealType, maxPrepMinutes, and servings when present.
- Each recipe object fields:
  - title (string, required)
  - description (optional string, one sentence)
  - prepMinutes (optional positive integer)
  - servings (optional positive integer)
  - ingredients: array of { "name": string (align with fridge names), "amount"?: string }
  - optionalPantry: optional array of { "name": string, "purpose"?: string } for small pantry add-ons not on the fridge list
  - steps: array of short instruction strings
  - usedFromFridge: array of fridge item names this recipe relies on
  - reason (optional one-sentence note why this fits the user)

Shape:
{"recipes":[{"title":"...","steps":["..."],"ingredients":[{"name":"..."}],"optionalPantry":[{"name":"salt","purpose":"season"}],"usedFromFridge":["..."]}]}
`.trim();
}

function normalizeGeneratedRecipe(raw, includeReasons) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || '').trim();
  if (!title) return null;

  const ingredients = Array.isArray(raw.ingredients)
    ? raw.ingredients
        .map((x) => {
          const name = String(x?.name || '').trim();
          if (!name) return null;
          const amount = x?.amount != null ? String(x.amount).trim() : '';
          return amount ? { name, amount } : { name };
        })
        .filter(Boolean)
    : [];

  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((s) => String(s || '').trim()).filter(Boolean)
    : [];

  const usedFromFridge = Array.isArray(raw.usedFromFridge)
    ? [...new Set(raw.usedFromFridge.map((s) => String(s || '').trim()).filter(Boolean))]
    : [];

  const optionalPantry = Array.isArray(raw.optionalPantry)
    ? raw.optionalPantry
        .map((x) => {
          const name = String(x?.name || '').trim();
          if (!name) return null;
          const purpose = String(x?.purpose || '').trim();
          return purpose ? { name, purpose: purpose.slice(0, 120) } : { name };
        })
        .filter(Boolean)
    : [];

  if (!steps.length) return null;

  const out = {
    source: 'generated',
    title,
    ingredients,
    steps,
    usedFromFridge,
  };

  if (optionalPantry.length) out.optionalPantry = optionalPantry;

  const desc = String(raw.description || '').trim();
  if (desc) out.description = desc.slice(0, 600);

  const pm = Number(raw.prepMinutes);
  if (Number.isFinite(pm) && pm > 0) out.prepMinutes = Math.min(Math.round(pm), 999);

  const sv = Number(raw.servings);
  if (Number.isFinite(sv) && sv > 0) out.servings = Math.min(Math.round(sv), 50);

  const reason = includeReasons ? String(raw.reason || '').trim().slice(0, 500) : '';
  out.personalization = { strategy: 'generated' };
  if (reason) out.personalization.reason = reason;

  return out;
}

/**
 * @param {object} params
 * @param {Array<{ name: string, quantity?: number, unit?: string, category?: string }>} params.fridgeItems
 * @param {object} params.profile
 * @param {number} params.maxRecipes
 * @param {boolean} params.includeReasons
 * @returns {Promise<{ recipes: object[], error?: string }>}
 */
async function generateRecipesFromFridgeInventory({ fridgeItems, profile, maxRecipes, includeReasons }) {
  if (!GEMINI_API_KEY) {
    return { recipes: [], error: 'GEMINI_API_KEY is not set' };
  }

  const capped = Math.min(Math.max(Number(maxRecipes) || 1, 1), 15);
  const items = Array.isArray(fridgeItems) ? fridgeItems.slice(0, 55) : [];
  const fridgeItemsJson = JSON.stringify(items);
  const prompt = buildPrompt({ fridgeItemsJson, profile, maxRecipes: capped });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_FRIDGE_RECIPE_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: Number.isFinite(GEMINI_FRIDGE_RECIPE_TEMPERATURE) ? GEMINI_FRIDGE_RECIPE_TEMPERATURE : 0.45,
      maxOutputTokens: Number.isFinite(GEMINI_FRIDGE_RECIPE_MAX_TOKENS) ? GEMINI_FRIDGE_RECIPE_MAX_TOKENS : 4096,
      response_mime_type: 'application/json',
    },
  };

  const json = await postJson(url, requestBody);
  const first = json?.candidates?.[0];
  if (!first) return { recipes: [], error: 'empty_model_response' };

  const textPart = first?.content?.parts?.find((part) => typeof part.text === 'string');
  const safeText = sanitizeJsonText(textPart?.text || '');
  if (!safeText) return { recipes: [], error: 'empty_text' };

  let parsed;
  try {
    parsed = JSON.parse(safeText);
  } catch (err) {
    return { recipes: [], error: 'invalid_json' };
  }

  const list = Array.isArray(parsed?.recipes) ? parsed.recipes : [];
  const recipes = [];
  for (const row of list) {
    const norm = normalizeGeneratedRecipe(row, includeReasons);
    if (norm) recipes.push(norm);
    if (recipes.length >= capped) break;
  }

  return { recipes };
}

module.exports = {
  generateRecipesFromFridgeInventory,
  __private: { sanitizeJsonText, normalizeGeneratedRecipe },
};
