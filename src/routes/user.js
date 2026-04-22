const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { apiLimiter, strictLimiter } = require('../middleware/rateLimiters');
const { setUserPreference, setHealthGoals } = require('../controllers/userController');
const {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require('../controllers/notificationsController');


router.post('/set-preferences', apiLimiter, verifyToken, setUserPreference);
router.post('/set-health-goals', apiLimiter, verifyToken, setHealthGoals);

router.get('/notifications', apiLimiter, verifyToken, listNotifications);
router.post('/notifications/read-all', apiLimiter, verifyToken, markAllNotificationsRead);
router.post('/notifications/:notificationId/read', apiLimiter, verifyToken, markNotificationRead);


module.exports = router;
