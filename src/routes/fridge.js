const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { apiLimiter, strictLimiter } = require('../middleware/rateLimiters');
const { addItemToFridge, removeItemFromFridge, updateItemInFridge, getUserFridge } = require('../controllers/fridgeController');


router.post('/add-item', apiLimiter, verifyToken, addItemToFridge);
router.delete('/remove-item', apiLimiter, verifyToken, removeItemFromFridge);
router.patch('/update-item', apiLimiter, verifyToken, updateItemInFridge);
router.get('/get-item', apiLimiter, verifyToken, getUserFridge);

module.exports = router;
