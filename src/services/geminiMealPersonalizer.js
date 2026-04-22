const https = require('https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_RECOMMENDER_MODEL =
  process.env.GEMINI_RECOMMENDER_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_RECOMMENDER_TEMPERATURE = Number(process.env.GEMINI_RECOMMENDER_TEMPERATURE ?? 0.4);
const GEMINI_RECOMMENDER_MAX_TOKENS = Number(process.env.GEMINI_RECOMMENDER_MAX_TOKENS ?? 2048);

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

function normalizeRecommendationOutput(parsed, candidateIdSet, includeReasons) {
  const out = { recommendations: [] };
  if (!parsed || typeof parsed !== 'object') return out;
  if (!Array.isArray(parsed.recommendations)) return out;

  const seen = new Set();
  for (const item of parsed.recommendations) {
    if (!item || typeof item !== 'object') continue;
    const idMeal = String(item.idMeal || '').trim();
    if (!idMeal || seen.has(idMeal) || !candidateIdSet.has(idMeal)) continue;
    seen.add(idMeal);

    const effort = String(item.effort || '').trim().toLowerCase();
    const cookMinutes = Number(item.cookMinutes);
    const score = Number(item.personalizationScore);
    const reason = includeReasons ? String(item.reason || '').trim() : '';

    out.recommendations.push({
      idMeal,
      reason: includeReasons ? reason : undefined,
      effort: ['easy', 'medium', 'hard'].includes(effort) ? effort : 'medium',
      cookMinutes: Number.isFinite(cookMinutes) && cookMinutes > 0 ? Math.round(cookMinutes) : null,
      personalizationScore:
        Number.isFinite(score) && score >= 0 && score <= 100 ? Math.round(score) : null,
    });
  }

  return out;
}

function buildPrompt({ profile, candidates, limit, includeReasons }) {
  const reasonRule = includeReasons
    ? '- reason: one concise sentence tying recommendation to user habits/preferences.'
    : '- reason: empty string.';

  const sp = profile?.sessionPreferences || {};
  const sessionRules = [];
  if (sp.cuisine) {
    sessionRules.push(
      `- Cuisine preference: "${sp.cuisine}". Prefer candidates whose area/category fits; if none fit well, pick the closest culturally compatible option from the list.`
    );
  }
  if (sp.mealType) {
    sessionRules.push(
      `- Meal occasion: "${sp.mealType}". Prefer recipes that fit this occasion (name, category, or typical serving context).`
    );
  }
  if (sp.servings != null && Number.isFinite(sp.servings)) {
    sessionRules.push(
      `- Servings: about ${sp.servings} people. Prefer recipes that scale reasonably or note batch size in the reason when helpful.`
    );
  }
  if (sp.maxPrepMinutes != null && Number.isFinite(sp.maxPrepMinutes)) {
    sessionRules.push(
      `- Time budget: active prep + cooking should fit within about ${sp.maxPrepMinutes} minutes. Use cookMinutesEstimate when present; otherwise infer cautiously and stay under the budget.`
    );
  }
  const sessionBlock =
    sessionRules.length > 0
      ? `\nSESSION_REQUEST:\n${sessionRules.join('\n')}\n`
      : '';

  return `
You are a meal recommendation engine.
Rank meals for this specific user profile.

USER_PROFILE_JSON:
${JSON.stringify(profile)}

RECIPE_CANDIDATES_JSON:
${JSON.stringify(candidates)}
${sessionBlock}
RULES:
- Return exactly ${limit} items if possible, otherwise as many valid items as available.
- Only use idMeal values that exist in RECIPE_CANDIDATES_JSON.
- Favor meals with fewer missingIngredients and higher matchCount.
- Respect restrictions/current_diet and avoid contradictory picks.
- Honor sessionPreferences in USER_PROFILE_JSON when ranking (cuisine, mealType, servings, maxPrepMinutes).
- personalizationScore is integer 0-100.
- effort is one of: "easy", "medium", "hard".
- cookMinutes should be a reasonable integer estimate.
${reasonRule}

OUTPUT (strict JSON only):
{
  "recommendations": [
    {
      "idMeal": "52772",
      "personalizationScore": 87,
      "effort": "easy",
      "cookMinutes": 25,
      "reason": "Uses your frequent ingredients and aligns with your calorie target."
    }
  ]
}
`;
}

async function personalizeWithGemini({ profile, candidates, limit, includeReasons }) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_RECOMMENDER_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const prompt = buildPrompt({ profile, candidates, limit, includeReasons });
  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: Number.isFinite(GEMINI_RECOMMENDER_TEMPERATURE)
        ? GEMINI_RECOMMENDER_TEMPERATURE
        : 0.4,
      maxOutputTokens: Number.isFinite(GEMINI_RECOMMENDER_MAX_TOKENS)
        ? GEMINI_RECOMMENDER_MAX_TOKENS
        : 2048,
      response_mime_type: 'application/json',
    },
  };

  const json = await postJson(url, requestBody);
  const first = json?.candidates?.[0];
  if (!first) throw new Error('Gemini returned no candidates');
  if (first.finishReason === 'MAX_TOKENS') {
    throw new Error('Gemini response truncated (MAX_TOKENS)');
  }

  const textPart = first?.content?.parts?.find((part) => typeof part.text === 'string');
  const safeText = sanitizeJsonText(textPart?.text || '');
  if (!safeText) throw new Error('Gemini returned empty response');

  let parsed;
  try {
    parsed = JSON.parse(safeText);
  } catch (err) {
    throw new Error('Gemini did not return valid JSON');
  }

  const candidateIdSet = new Set(candidates.map((c) => String(c.idMeal)));
  return normalizeRecommendationOutput(parsed, candidateIdSet, includeReasons);
}

module.exports = {
  personalizeWithGemini,
  __private: {
    sanitizeJsonText,
    normalizeRecommendationOutput,
  },
};
