const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { apiLimiter } = require('../middleware/rateLimiters');
const {
    createGroceryList,
    getGroceryLists,
    getGroceryList,
    addItemsToList,
    addMissingIngredientsToList,
    updateItemPurchaseStatus,
    bulkUpdatePurchaseStatus,
    addItemToFridge,
    deleteItemFromList,
    archiveGroceryList,
    deleteGroceryList,
} = require('../controllers/groceryListController');

// List management
router.post('/lists', verifyToken, apiLimiter, createGroceryList);
router.get('/lists', verifyToken, apiLimiter, getGroceryLists);
router.get('/lists/:listId', verifyToken, apiLimiter, getGroceryList);
router.delete('/lists/:listId', verifyToken, apiLimiter, deleteGroceryList);
router.patch('/lists/:listId/archive', verifyToken, apiLimiter, archiveGroceryList);

// Item management
router.post('/lists/:listId/items', verifyToken, apiLimiter, addItemsToList);
router.post('/lists/:listId/missing-ingredients', verifyToken, apiLimiter, addMissingIngredientsToList);
router.delete('/lists/:listId/items/:itemId', verifyToken, apiLimiter, deleteItemFromList);
router.patch('/lists/:listId/items/:itemId/purchase', verifyToken, apiLimiter, updateItemPurchaseStatus);
router.patch('/lists/:listId/items/purchase-batch', verifyToken, apiLimiter, bulkUpdatePurchaseStatus);

// Fridge integration
router.post('/lists/:listId/items/:itemId/add-to-fridge', verifyToken, apiLimiter, addItemToFridge);

module.exports = router;
