const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { apiLimiter } = require('../middleware/rateLimiters');
const { getWeekPlan, listWeekPlans, postWeekPlan, patchWeekSlot, postWeekRebalance } = require('../controllers/mealPlanController');

router.get('/weeks', apiLimiter, verifyToken, listWeekPlans);
router.get('/week', apiLimiter, verifyToken, getWeekPlan);
router.post('/week', apiLimiter, verifyToken, postWeekPlan);
router.post('/week/rebalance', apiLimiter, verifyToken, postWeekRebalance);
router.patch('/week/slot', apiLimiter, verifyToken, patchWeekSlot);

module.exports = router;
