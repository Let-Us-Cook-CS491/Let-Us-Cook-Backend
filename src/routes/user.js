const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { apiLimiter, strictLimiter } = require('../middleware/rateLimiters');
const { setUserPreference, setHealthGoals } = require('../controllers/userController');


router.post('/set-preferences', apiLimiter, verifyToken, setUserPreference);
router.post('/set-health-goals', apiLimiter, verifyToken, setHealthGoals);


module.exports = router;
