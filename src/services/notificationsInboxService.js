const db = require('../config/databaseConnection');
const { isAllowedNotificationPage } = require('../constants/notificationPages');

const MAX_PAGE_LEN = 32;
const MAX_MESSAGE_LEN = 1000;
/** Skip inserting if the same user+page+message exists within this many hours. */
const DEFAULT_DEDUP_HOURS = 24;

function normalizePage(page) {
  const s = String(page ?? '').trim();
  if (!s) return { ok: false, error: 'page is required' };
  if (!isAllowedNotificationPage(s)) {
    return { ok: false, error: 'page must be a known notification route' };
  }
  if (s.length > MAX_PAGE_LEN) {
    return { ok: false, error: `page must be at most ${MAX_PAGE_LEN} characters` };
  }
  return { ok: true, value: s };
}

function normalizeMessage(message) {
  if (message === undefined || message === null) return { ok: true, value: null };
  let s = String(message).trim();
  if (s.length > MAX_MESSAGE_LEN) {
    s = s.slice(0, MAX_MESSAGE_LEN);
  }
  return { ok: true, value: s || null };
}

/**
 * @param {object} params
 * @param {number} params.userId
 * @param {string} params.page
 * @param {string|null|undefined} params.message
 * @param {number} [params.dedupHours]
 * @param {boolean} [params.skipDedup]
 * @returns {Promise<{ inserted: boolean, notificationId?: number }>}
 */
async function insertNotification({
  userId,
  page,
  message,
  dedupHours = DEFAULT_DEDUP_HOURS,
  skipDedup = false,
}) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid < 1) {
    throw new Error('userId must be a positive integer');
  }

  const pageNorm = normalizePage(page);
  if (!pageNorm.ok) throw new Error(pageNorm.error);

  const msgNorm = normalizeMessage(message);
  if (!msgNorm.ok) throw new Error(msgNorm.error);

  if (!skipDedup && dedupHours > 0 && msgNorm.value) {
    const dupSql = `
      SELECT notification_id
      FROM notifications_inbox
      WHERE user_id = ?
        AND page = ?
        AND message = ?
        AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
      LIMIT 1
    `;
    const [dupRows] = await db.execute(dupSql, [uid, pageNorm.value, msgNorm.value, dedupHours]);
    if (dupRows.length > 0) {
      return { inserted: false, notificationId: dupRows[0].notification_id };
    }
  }

  const insertSql = `
    INSERT INTO notifications_inbox (user_id, page, message)
    VALUES (?, ?, ?)
  `;
  const [result] = await db.execute(insertSql, [uid, pageNorm.value, msgNorm.value]);
  return { inserted: true, notificationId: result.insertId };
}

/**
 * Fan-out one notification to every user on the given fridge.
 * @param {object} params
 * @param {number} params.fridgeId
 * @param {string} params.page
 * @param {string|null|undefined} params.message
 * @param {number} [params.dedupHours]
 */
async function insertNotificationsForFridge({
  fridgeId,
  page,
  message,
  dedupHours = DEFAULT_DEDUP_HOURS,
}) {
  const fid = Number(fridgeId);
  if (!Number.isInteger(fid) || fid < 1) {
    throw new Error('fridgeId must be a positive integer');
  }

  const recipientsSql = `SELECT user_id FROM users WHERE fridge_id = ?`;
  const [rows] = await db.execute(recipientsSql, [fid]);
  const userIds = rows.map((r) => Number(r.user_id)).filter((id) => Number.isInteger(id) && id > 0);

  const results = [];
  for (const userId of userIds) {
    try {
      const r = await insertNotification({ userId, page, message, dedupHours });
      results.push({ userId, ...r });
    } catch (e) {
      console.error('insertNotification failed for user', userId, e?.message || e);
      results.push({ userId, inserted: false, error: e?.message || String(e) });
    }
  }
  return { fridgeId: fid, recipients: userIds.length, results };
}

module.exports = {
  insertNotification,
  insertNotificationsForFridge,
  DEFAULT_DEDUP_HOURS,
  MAX_PAGE_LEN,
  MAX_MESSAGE_LEN,
};
