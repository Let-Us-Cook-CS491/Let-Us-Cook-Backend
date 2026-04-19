const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { apiLimiter } = require('../middleware/rateLimiters');
const { getWeekPlan, listWeekPlans, postWeekPlan, patchWeekSlot } = require('../controllers/mealPlanController');

router.get('/weeks', apiLimiter, verifyToken, listWeekPlans);
router.get('/week', apiLimiter, verifyToken, getWeekPlan);
router.post('/week', apiLimiter, verifyToken, postWeekPlan);
router.patch('/week/slot', apiLimiter, verifyToken, patchWeekSlot);

module.exports = router;
