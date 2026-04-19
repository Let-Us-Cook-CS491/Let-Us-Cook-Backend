const db = require('../config/databaseConnection');

/**
 * Resolves MySQL users.fridge_id for a JWT user_id (same pattern as fridgeController).
 * @param {number} userId
 * @returns {Promise<{ status: 'OK', fridgeId: number } | { status: 'USER_NOT_FOUND' } | { status: 'INVALID_FRIDGE' }>}
 */
async function resolveFridgeIdForUser(userId) {
  const [userRows] = await db.execute('SELECT fridge_id FROM users WHERE user_id = ? LIMIT 1', [userId]);
  const row = userRows?.[0];
  if (!row) {
    return { status: 'USER_NOT_FOUND' };
  }
  const fridgeId = Number(row.fridge_id);
  if (!Number.isInteger(fridgeId) || fridgeId < 1) {
    return { status: 'INVALID_FRIDGE' };
  }
  return { status: 'OK', fridgeId };
}

module.exports = {
  resolveFridgeIdForUser,
};
