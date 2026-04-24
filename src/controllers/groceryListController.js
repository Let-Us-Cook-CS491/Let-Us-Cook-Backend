const groceryListService = require('../services/groceryListService');

function parseUserId(req) {
    const user_id = Number(req.user?.user_id);
    if (!Number.isInteger(user_id)) {
        return null;
    }
    return user_id;
}

exports.createGroceryList = async (req, res) => {
    try {
        const user_id = parseUserId(req);
        if (!user_id) {
            return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
        }

        const result = await groceryListService.createGroceryList(user_id, req.body || {});
        if (!result.ok) {
            return res.status(result.status).json({ status: 'ERROR', message: result.message });
        }

        const response = {
            status: 'OK',
            message: 'Grocery list created',
            data: { list: result.list },
        };

        if (result.warnings && result.warnings.length > 0) {
            response.data.warnings = result.warnings;
        }

        return res.status(201).json(response);
    } catch (err) {
        console.error('createGroceryList error:', err);
        return res.status(500).json({ status: 'ERROR', message: 'Failed to create grocery list' });
    }
};

exports.getGroceryLists = async (req, res) => {
    try {
        const user_id = parseUserId(req);
        if (!user_id) {
            return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
        }

        const result = await groceryListService.getGroceryLists(user_id, req.query || {});
        if (!result.ok) {
            return res.status(500).json({ status: 'ERROR', message: 'Failed to retrieve grocery lists' });
        }

        return res.status(200).json({
            status: 'OK',
            message: 'Grocery lists retrieved',
            data: {
                lists: result.lists,
                pagination: result.pagination,
            },
        });
    } catch (err) {
        console.error('getGroceryLists error:', err);
        return res.status(500).json({ status: 'ERROR', message: 'Failed to retrieve grocery lists' });
    }
};

exports.getGroceryList = async (req, res) => {
    try {
        const user_id = parseUserId(req);
        if (!user_id) {
            return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
        }

        const listId = req.params.listId;
        const result = await groceryListService.getGroceryList(user_id, listId);
        if (!result.ok) {
            return res.status(result.status).json({ status: 'ERROR', message: result.message });
        }

        return res.status(200).json({
            status: 'OK',
            message: 'Grocery list retrieved',
            data: {
                list: result.list,
                items_by_category: result.items_by_category,
                category_order: result.category_order,
                summary: result.summary,
            },
        });
    } catch (err) {
        console.error('getGroceryList error:', err);
        return res.status(500).json({ status: 'ERROR', message: 'Failed to retrieve grocery list' });
    }
};

exports.addItemsToList = async (req, res) => {
    try {
        const user_id = parseUserId(req);
        if (!user_id) {
            return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
        }

        const listId = req.params.listId;
        const items = req.body?.items;

        if (!Array.isArray(items)) {
            return res.status(400).json({ status: 'ERROR', message: 'items array is required' });
        }

        const result = await groceryListService.addItemsToList(user_id, listId, items);
        if (!result.ok) {
            return res.status(result.status).json({ status: 'ERROR', message: result.message });
        }

        return res.status(200).json({
            status: 'OK',
            message: 'Items added to list',
            data: { list: result.list },
        });
    } catch (err) {
        console.error('addItemsToList error:', err);
        return res.status(500).json({ status: 'ERROR', message: 'Failed to add items to list' });
    }
};

exports.addMissingIngredientsToList = async (req, res) => {
    try {
        const user_id = parseUserId(req);
        if (!user_id) {
            return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
        }

        const listId = req.params.listId;
        const {
            sourceSurface,
            recipeId,
            recipeTitle,
            mode,
            ingredients,
        } = req.body || {};

        if (!['suggest', 'browse'].includes(sourceSurface)) {
            return res.status(400).json({ status: 'ERROR', message: 'sourceSurface must be suggest or browse' });
        }

        if (!recipeId || !String(recipeId).trim()) {
            return res.status(400).json({ status: 'ERROR', message: 'recipeId is required' });
        }

        if (!['single', 'all'].includes(mode)) {
            return res.status(400).json({ status: 'ERROR', message: 'mode must be single or all' });
        }

        if (!Array.isArray(ingredients)) {
            return res.status(400).json({ status: 'ERROR', message: 'ingredients array is required' });
        }

        if (mode === 'single' && ingredients.length !== 1) {
            return res.status(400).json({ status: 'ERROR', message: 'single mode requires exactly one ingredient' });
        }

        if (mode === 'all' && ingredients.length < 1) {
            return res.status(400).json({ status: 'ERROR', message: 'all mode requires at least one ingredient' });
        }

        const result = await groceryListService.addMissingIngredientsToList(user_id, listId, {
            sourceSurface,
            recipeId,
            recipeTitle,
            mode,
            ingredients,
        });
        if (!result.ok) {
            return res.status(result.status).json({ status: 'ERROR', message: result.message });
        }

        return res.status(200).json({
            status: 'OK',
            message: `${result.added_count} missing ingredient(s) added to list`,
            data: {
                list: result.list,
                added_count: result.added_count,
                recipe: result.recipe,
                source_surface: result.source_surface,
                mode: result.mode,
            },
        });
    } catch (err) {
        console.error('addMissingIngredientsToList error:', err);
        return res.status(500).json({ status: 'ERROR', message: 'Failed to add missing ingredients to list' });
    }
};

exports.updateItemPurchaseStatus = async (req, res) => {
    try {
        const user_id = parseUserId(req);
        if (!user_id) {
            return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
        }

        const { listId, itemId } = req.params;
        const purchased = req.body?.purchased;

        if (typeof purchased !== 'boolean') {
            return res.status(400).json({ status: 'ERROR', message: 'purchased (boolean) is required' });
        }

        const result = await groceryListService.updateItemPurchaseStatus(user_id, listId, itemId, purchased);
        if (!result.ok) {
            return res.status(result.status).json({ status: 'ERROR', message: result.message });
        }

        return res.status(200).json({
            status: 'OK',
            message: 'Item purchase status updated',
            data: { list: result.list },
        });
    } catch (err) {
        console.error('updateItemPurchaseStatus error:', err);
        return res.status(500).json({ status: 'ERROR', message: 'Failed to update item purchase status' });
    }
};

exports.bulkUpdatePurchaseStatus = async (req, res) => {
    try {
        const user_id = parseUserId(req);
        if (!user_id) {
            return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
        }

        const listId = req.params.listId;
        const { itemIds, purchased } = req.body || {};

        if (!Array.isArray(itemIds)) {
            return res.status(400).json({ status: 'ERROR', message: 'itemIds array is required' });
        }

        if (typeof purchased !== 'boolean') {
            return res.status(400).json({ status: 'ERROR', message: 'purchased (boolean) is required' });
        }

        const result = await groceryListService.bulkUpdatePurchaseStatus(user_id, listId, itemIds, purchased);
        if (!result.ok) {
            return res.status(result.status).json({ status: 'ERROR', message: result.message });
        }

        return res.status(200).json({
            status: 'OK',
            message: `${result.updated_count} item(s) updated`,
            data: { list: result.list, updated_count: result.updated_count },
        });
    } catch (err) {
        console.error('bulkUpdatePurchaseStatus error:', err);
        return res.status(500).json({ status: 'ERROR', message: 'Failed to update items' });
    }
};

exports.addItemToFridge = async (req, res) => {
    try {
        const user_id = parseUserId(req);
        if (!user_id) {
            return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
        }

        const { listId, itemId } = req.params;
        const fridgeData = req.body || {};

        const result = await groceryListService.addItemToFridge(user_id, listId, itemId, fridgeData);
        if (!result.ok) {
            return res.status(result.status).json({ status: 'ERROR', message: result.message });
        }

        return res.status(200).json({
            status: 'OK',
            message: 'Item added to fridge',
            data: {
                list: result.list,
                fridge_item: result.fridge_item,
            },
        });
    } catch (err) {
        console.error('addItemToFridge error:', err);
        return res.status(500).json({ status: 'ERROR', message: 'Failed to add item to fridge' });
    }
};

exports.deleteItemFromList = async (req, res) => {
    try {
        const user_id = parseUserId(req);
        if (!user_id) {
            return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
        }

        const { listId, itemId } = req.params;

        const result = await groceryListService.deleteItemFromList(user_id, listId, itemId);
        if (!result.ok) {
            return res.status(result.status).json({ status: 'ERROR', message: result.message });
        }

        return res.status(200).json({
            status: 'OK',
            message: 'Item deleted from list',
            data: { list: result.list },
        });
    } catch (err) {
        console.error('deleteItemFromList error:', err);
        return res.status(500).json({ status: 'ERROR', message: 'Failed to delete item' });
    }
};

exports.archiveGroceryList = async (req, res) => {
    try {
        const user_id = parseUserId(req);
        if (!user_id) {
            return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
        }

        const listId = req.params.listId;

        const result = await groceryListService.archiveGroceryList(user_id, listId);
        if (!result.ok) {
            return res.status(result.status).json({ status: 'ERROR', message: result.message });
        }

        return res.status(200).json({
            status: 'OK',
            message: 'Grocery list archived',
            data: { list: result.list },
        });
    } catch (err) {
        console.error('archiveGroceryList error:', err);
        return res.status(500).json({ status: 'ERROR', message: 'Failed to archive list' });
    }
};

exports.deleteGroceryList = async (req, res) => {
    try {
        const user_id = parseUserId(req);
        if (!user_id) {
            return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
        }

        const listId = req.params.listId;

        const result = await groceryListService.deleteGroceryList(user_id, listId);
        if (!result.ok) {
            return res.status(result.status).json({ status: 'ERROR', message: result.message });
        }

        return res.status(200).json({
            status: 'OK',
            message: 'Grocery list deleted',
        });
    } catch (err) {
        console.error('deleteGroceryList error:', err);
        return res.status(500).json({ status: 'ERROR', message: 'Failed to delete list' });
    }
};
