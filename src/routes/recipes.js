const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { apiLimiter } = require('../middleware/rateLimiters');
const { suggestRecipesFromFridge } = require('../controllers/recipeSuggestController');

router.get('/suggest', verifyToken, apiLimiter, suggestRecipesFromFridge);

module.exports = router;
