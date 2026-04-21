const db = require('../config/databaseConnection');

function parsePositiveInt(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

function parseBooleanQuery(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const s = String(value).trim().toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return fallback;
}

exports.listNotifications = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    if (!Number.isInteger(user_id)) {
      return res.status(401).json({
        status: 'ERROR',
        message: 'Unauthorized User',
      });
    }

    const limit = parsePositiveInt(req.query?.limit, 50, 100);
    const beforeId = req.query?.beforeId;
    const unreadOnly = parseBooleanQuery(req.query?.unreadOnly, false);

    const beforeNum = beforeId !== undefined && beforeId !== null && String(beforeId).trim() !== ''
      ? Number(beforeId)
      : null;
    const useCursor = Number.isInteger(beforeNum) && beforeNum > 0;

    let sql = `
      SELECT notification_id, page, message, created_at, read_at
      FROM notifications_inbox
      WHERE user_id = ?
    `;
    const params = [user_id];

    if (unreadOnly) {
      sql += ' AND read_at IS NULL';
    }
    if (useCursor) {
      sql += ' AND notification_id < ?';
      params.push(beforeNum);
    }
    // LIMIT cannot use a bound parameter on some MySQL builds (ER_WRONG_ARGUMENTS).
    // `limit` is already a bounded integer from parsePositiveInt (1..100).
    sql += ` ORDER BY notification_id DESC LIMIT ${limit}`;

    const [rows] = await db.execute(sql, params);

    return res.status(200).json({
      status: 'OK',
      message: 'Notifications fetched',
      data: {
        notifications: rows,
        nextCursor:
          rows.length === limit && rows.length > 0
            ? String(rows[rows.length - 1].notification_id)
            : null,
      },
    });
  } catch (err) {
    console.error('listNotifications error:', err);
    return res.status(500).json({
      status: 'ERROR',
      message: 'Failed to fetch notifications',
    });
  }
};

exports.markNotificationRead = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    if (!Number.isInteger(user_id)) {
      return res.status(401).json({
        status: 'ERROR',
        message: 'Unauthorized User',
      });
    }

    const notificationId = Number(req.params?.notificationId);
    if (!Number.isInteger(notificationId) || notificationId < 1) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Invalid notification id',
      });
    }

    const sql = `
      UPDATE notifications_inbox
      SET read_at = NOW()
      WHERE notification_id = ?
        AND user_id = ?
        AND read_at IS NULL
    `;
    const [result] = await db.execute(sql, [notificationId, user_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: 'ERROR',
        message: 'Notification not found or already read',
      });
    }

    return res.status(200).json({
      status: 'OK',
      message: 'Notification marked read',
    });
  } catch (err) {
    console.error('markNotificationRead error:', err);
    return res.status(500).json({
      status: 'ERROR',
      message: 'Failed to mark notification read',
    });
  }
};

exports.markAllNotificationsRead = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    if (!Number.isInteger(user_id)) {
      return res.status(401).json({
        status: 'ERROR',
        message: 'Unauthorized User',
      });
    }

    const sql = `
      UPDATE notifications_inbox
      SET read_at = NOW()
      WHERE user_id = ?
        AND read_at IS NULL
    `;
    const [result] = await db.execute(sql, [user_id]);

    return res.status(200).json({
      status: 'OK',
      message: 'All notifications marked read',
      data: { updatedCount: result.affectedRows },
    });
  } catch (err) {
    console.error('markAllNotificationsRead error:', err);
    return res.status(500).json({
      status: 'ERROR',
      message: 'Failed to mark all notifications read',
    });
  }
};
