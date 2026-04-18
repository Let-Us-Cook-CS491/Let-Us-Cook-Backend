const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { apiLimiter } = require('../middleware/rateLimiters');
const {
  suggestRecipesFromFridge,
  getPersonalizedRecommendations,
} = require('../controllers/recipeSuggestController');

router.get('/suggest', verifyToken, apiLimiter, suggestRecipesFromFridge);
router.get('/personalized', verifyToken, apiLimiter, getPersonalizedRecommendations);

module.exports = router;
