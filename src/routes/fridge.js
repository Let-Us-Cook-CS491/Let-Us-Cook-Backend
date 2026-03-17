const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { apiLimiter } = require('../middleware/rateLimiters');
const { upload } = require('../middleware/upload');
const { addItemToFridge, uploadReceiptToFridge, confirmReceiptItems } = require('../controllers/fridgeController');


router.post('/add-item', verifyToken, apiLimiter, addItemToFridge);
router.post('/receipt', verifyToken, apiLimiter, upload.single('receipt'), uploadReceiptToFridge);
router.post('/receipt/confirm', verifyToken, apiLimiter, confirmReceiptItems);


module.exports = router;
