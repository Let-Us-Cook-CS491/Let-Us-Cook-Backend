const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { apiLimiter, strictLimiter } = require('../middleware/rateLimiters');
const { setUserPreference } = require('../controllers/userController');


router.post('/set-preferences', apiLimiter, verifyToken, setUserPreference);


module.exports = router;
