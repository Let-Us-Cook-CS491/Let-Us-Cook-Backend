const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { apiLimiter, strictLimiter } = require('../middleware/rateLimiters');
const { addItemToFridge, removeItemFromFridge } = require('../controllers/fridgeController');


router.post('/add-item', verifyToken, apiLimiter, addItemToFridge);
router.delete('/remove-item', verifyToken, apiLimiter, removeItemFromFridge);


module.exports = router;
