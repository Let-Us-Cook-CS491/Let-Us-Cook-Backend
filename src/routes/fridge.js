const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { apiLimiter, strictLimiter } = require('../middleware/rateLimiters');
const { upload } = require('../middleware/upload');
const {
  addItemToFridge,
  uploadReceiptToFridge,
  confirmReceiptItems,
  updateItemInFridge,
  getUserFridge,
  removeItemFromFridge,
  createFridgeInvite,
  joinFridgeByInvite,
} = require('../controllers/fridgeController');


router.post('/receipt', verifyToken, strictLimiter, upload.single('receipt'), uploadReceiptToFridge);
router.post('/receipt/confirm', verifyToken, apiLimiter, confirmReceiptItems);
router.post('/add-item', apiLimiter, verifyToken, addItemToFridge);
router.delete('/remove-item', apiLimiter, verifyToken, removeItemFromFridge);
router.patch('/update-item', apiLimiter, verifyToken, updateItemInFridge);
router.get('/get-item', apiLimiter, verifyToken, getUserFridge);
router.post('/:fridgeId/invite', apiLimiter, verifyToken, createFridgeInvite);
router.post('/join', apiLimiter, verifyToken, joinFridgeByInvite);

module.exports = router;
