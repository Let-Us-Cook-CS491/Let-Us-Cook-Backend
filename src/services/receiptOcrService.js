const vision = require('@google-cloud/vision');
const fs = require('fs');
const os = require('os');
const path = require('path');

let client = null;
let credentialsTempPath = null;

function ensureCredentialsFromEnvJson() {
  const json = process.env.GOOGLE_VISION_SA_JSON;
  if (!json) return;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;
  if (credentialsTempPath) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsTempPath;
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error('GOOGLE_VISION_SA_JSON is not valid JSON');
  }

  if (!parsed || parsed.type !== 'service_account') {
    throw new Error('GOOGLE_VISION_SA_JSON must be a service account JSON key');
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'let-us-cook-vision-'));
  const filePath = path.join(dir, 'vision-sa.json');
  fs.writeFileSync(filePath, JSON.stringify(parsed), { encoding: 'utf8', mode: 0o600 });

  credentialsTempPath = filePath;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = filePath;
}

function getVisionClient() {
  if (client) return client;

  ensureCredentialsFromEnvJson();

  // In dev, most people rely on .env being loaded into process.env.
  // The library uses ADC; this check just improves the error message.
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_CLOUD_PROJECT) {
    throw new Error(
      'Google Vision credentials not configured. Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON path, or set GOOGLE_VISION_SA_JSON to the full service account JSON, or run on GCP with ADC.'
    );
  }

  client = new vision.ImageAnnotatorClient();
  return client;
}

async function extractReceiptText(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('No receipt image buffer provided');
  }

  const visionClient = getVisionClient();
  const [result] = await visionClient.documentTextDetection({
    image: { content: buffer },
  });

  const annotation = result?.fullTextAnnotation;
  const text = annotation?.text;
  return (text || '').trim();
}

module.exports = { extractReceiptText };

