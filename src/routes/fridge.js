const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { apiLimiter, strictLimiter } = require('../middleware/rateLimiters');
const { addItemToFridge, removeItemFromFridge, updateItemInFridge } = require('../controllers/fridgeController');


router.post('/add-item', verifyToken, apiLimiter, addItemToFridge);
router.delete('/remove-item', verifyToken, apiLimiter, removeItemFromFridge);
router.patch('/update-item', verifyToken, apiLimiter, updateItemInFridge);

module.exports = router;
