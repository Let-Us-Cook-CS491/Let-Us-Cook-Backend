const express = require('express');
const router = express.Router();
const { apiLimiter, strictLimiter } = require('../middleware/rateLimiters');
const { signup, login, refreshToken, logout } = require('../controllers/authController');


router.post('/signup', strictLimiter, signup);
router.post('/login', strictLimiter, login);
router.post('/refresh', apiLimiter, refreshToken);
router.post('/logout', apiLimiter, logout);


module.exports = router;
