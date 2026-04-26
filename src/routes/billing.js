const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { apiLimiter } = require('../middleware/rateLimiters');
const {
    createCheckoutSession,
    getCurrentSubscription,
    handleStripeWebhook,
} = require('../controllers/billingController');

router.post('/checkout-session', apiLimiter, verifyToken, createCheckoutSession);
router.get('/subscription', apiLimiter, verifyToken, getCurrentSubscription);
router.post('/webhook', handleStripeWebhook);

module.exports = router;
