const https = require('https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Default to gemini-2.5-flash unless overridden via GEMINI_MODEL.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);

    const options = {
      method: 'POST',
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(
            new Error(`Gemini API error: ${res.statusCode} ${raw.slice(0, 500)}`)
          );
        }
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed);
        } catch (e) {
          reject(new Error('Failed to parse Gemini response JSON'));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(data);
    req.end();
  });
}

function buildPrompt() {
  return `
You are extracting purchasable items from a store receipt.

TASK:
- Return ONLY actual items that a user might store in their fridge or pantry (food and drink).
- Ignore store name, address, phone, VAT, registration, table number, clerk id, dates/times, website, totals, taxes, payment info, and any metadata.
- For combo lines like "1 LRG COD & CHIPS 11.95", treat it as one item.
- For quantity lines like "3 SOFT DRINK", set quantity = 3 and unit = "pcs".
- Do not invent items that are not clearly on the receipt.

OUTPUT:
- Strict JSON, no prose, no markdown.
- Shape:
{
  "items": [
    {
      "name": "fish & chips",
      "quantity": 1,
      "unit": "pcs",
      "category": "Protein",
      "sourceLine": "1 LRG COD & CHIPS 11.95"
    }
  ]
}

Rules:
- name: short human-readable item name in lowercase.
- quantity: positive number.
- unit: one of ["g","kg","ml","L","pcs","pack"] when possible; default to "pcs" if unclear.
- category: one of ["Produce","Protein","Dairy","Pantry","Bakery"].
- sourceLine: original receipt line or combined line used to infer the item.
`;
}

function normalizeGeminiOutput(data) {
  const safe = { items: [], skipped: [] };
  if (!data || typeof data !== 'object') return safe;

  if (Array.isArray(data.items)) {
    for (const raw of data.items) {
      if (!raw || typeof raw !== 'object') continue;
      const name = String(raw.name || '').trim().toLowerCase();
      if (!name) continue;

      const quantity = Number(raw.quantity ?? 1);
      const unit = String(raw.unit || 'pcs').trim();
      const category = String(raw.category || 'Pantry').trim();
      const sourceLine = raw.sourceLine ? String(raw.sourceLine) : '';

      safe.items.push({
        name,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        unit,
        category,
        sourceLine,
      });
    }
  }

  // We no longer ask Gemini to return `skipped`; keep field for backward compatibility.

  return safe;
}

async function parseWithGemini(ocrText) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const prompt = buildPrompt();

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { text: `RECEIPT_TEXT:\n${ocrText}` },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 4096,
      response_mime_type: 'application/json',
    },
  };

  const json = await postJson(url, requestBody);

  const candidates = json.candidates || [];
  const first = candidates[0];

  if (!first) {
    throw new Error('Gemini returned no candidates');
  }

  if (first.finishReason === 'MAX_TOKENS') {
    console.error(
      'Gemini response truncated due to max tokens; increase maxOutputTokens or simplify prompt.'
    );
    throw new Error('Gemini response truncated (MAX_TOKENS)');
  }

  const parts = first && first.content && first.content.parts;
  const textPart = parts && parts.find((p) => typeof p.text === 'string');
  let text = textPart?.text?.trim() || '';

  /*
  // Debug logging (disabled by default).
  // Uncomment when troubleshooting model responses.
  try {
    console.log(
      'Gemini raw response (truncated):',
      JSON.stringify(json).slice(0, 500)
    );
    console.log('Gemini text candidate (truncated):', text.slice(0, 500));
  } catch (e) {
    // Ignore logging failures.
  }
  */

  if (!text) {
    throw new Error('Gemini returned empty response');
  }

  // Be tolerant of markdown code fences or extra prose.
  // Strip common ```json ... ``` wrappers and keep the first JSON object braces.
  text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1).trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    /*
    // Debug logging (disabled by default).
    console.error('Gemini JSON parse failed. Text was:', text.slice(0, 500));
    */
    throw new Error('Gemini did not return valid JSON');
  }

  return normalizeGeminiOutput(parsed);
}

module.exports = { parseWithGemini };

