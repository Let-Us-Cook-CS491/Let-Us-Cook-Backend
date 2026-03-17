const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { apiLimiter, strictLimiter } = require('../middleware/rateLimiters');
const { addItemToFridge } = require('../controllers/fridgeController');


router.post('/add', verifyToken, apiLimiter, addItemToFridge);


module.exports = router;
