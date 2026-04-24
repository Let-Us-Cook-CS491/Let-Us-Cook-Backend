const { connectMongo } = require('../config/databaseConnection');
const GroceryList = require('../schemes/groceryList');
const FridgeItem = require('../schemes/fridgeItem');
const { resolveFridgeIdForUser } = require('./userFridgeResolver');

// Category ordering for optimal shopping flow
const CATEGORY_ORDER = [
    'Produce',
    'Meat',
    'Dairy',
    'Grains',
    'Pantry',
    'Frozen',
    'Beverages',
    'Other',
];

/**
 * Group items by category in optimal shopping order
 */
function groupItemsByCategory(items) {
    const grouped = {};

    // Initialize all categories
    for (const category of CATEGORY_ORDER) {
        grouped[category] = [];
    }

    // Group items
    for (const item of items) {
        const cat = item.category || 'Other';
        if (!grouped[cat]) {
            grouped[cat] = [];
        }
        grouped[cat].push(item);
    }

    // Remove empty categories
    const result = {};
    for (const category of CATEGORY_ORDER) {
        if (grouped[category].length > 0) {
            result[category] = grouped[category];
        }
    }

    // Add any custom categories not in CATEGORY_ORDER
    for (const [category, categoryItems] of Object.entries(grouped)) {
        if (!CATEGORY_ORDER.includes(category) && categoryItems.length > 0) {
            result[category] = categoryItems;
        }
    }

    return result;
}

/**
 * Check for duplicate items in active lists
 */
async function checkDuplicateItems(userId, newItems) {
    const activeLists = await GroceryList.find({
        user_id: userId,
        archived: false,
    }).lean();

    const newItemNames = new Set(newItems.map((item) => item.name.toLowerCase()));
    const warnings = [];

    for (const list of activeLists) {
        const duplicates = [];
        for (const item of list.items) {
            if (newItemNames.has(item.name.toLowerCase())) {
                duplicates.push(item.name);
            }
        }

        if (duplicates.length > 0) {
            warnings.push({
                type: 'duplicate_items',
                message: `You have ${duplicates.length} item(s) in another active list: '${list.name}'`,
                duplicate_items: duplicates,
                existing_list_id: list._id.toString(),
            });
        }
    }

    return warnings;
}

/**
 * Create a new grocery list
 */
async function createGroceryList(userId, body) {
    await connectMongo();

    const name = body.name ? String(body.name).trim() : 'Shopping List';
    const items = Array.isArray(body.items) ? body.items : [];

    // Validate and normalize items
    const normalizedItems = items.map((item) => ({
        name: String(item.name || '').trim(),
        category: item.category ? String(item.category).trim() : undefined,
        quantity: item.quantity ? Number(item.quantity) : undefined,
        unit: item.unit ? String(item.unit).trim() : undefined,
        source: item.source || 'manual',
        source_id: item.source_id ? String(item.source_id) : undefined,
        purchased: false,
        added_to_fridge: false,
    })).filter((item) => item.name);

    if (normalizedItems.length === 0) {
        return {
            ok: false,
            status: 400,
            message: 'At least one item with a name is required',
        };
    }

    // Check for duplicates
    const warnings = await checkDuplicateItems(userId, normalizedItems);

    // Create list
    const list = await GroceryList.create({
        user_id: userId,
        name,
        items: normalizedItems,
        archived: false,
    });

    return {
        ok: true,
        list: list.toObject(),
        warnings,
    };
}

/**
 * Get all grocery lists for a user
 */
async function getGroceryLists(userId, query) {
    await connectMongo();

    const archived = query?.archived === 'true';
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const skip = Math.max(Number(query?.skip) || 0, 0);

    const lists = await GroceryList.find({
        user_id: userId,
        archived,
    })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

    const total = await GroceryList.countDocuments({ user_id: userId, archived });

    return {
        ok: true,
        lists,
        pagination: {
            total,
            returned: lists.length,
            skip,
            limit,
            hasMore: skip + lists.length < total,
        },
    };
}

/**
 * Get a single grocery list
 */
async function getGroceryList(userId, listId) {
    await connectMongo();

    const list = await GroceryList.findOne({
        _id: listId,
        user_id: userId,
    }).lean();

    if (!list) {
        return {
            ok: false,
            status: 404,
            message: 'Grocery list not found',
        };
    }

    // Calculate summary
    const totalItems = list.items.length;
    const purchasedItems = list.items.filter((item) => item.purchased).length;
    const pendingItems = totalItems - purchasedItems;
    const readyForFridge = list.items.filter((item) => item.purchased && !item.added_to_fridge).length;

    // Group items by category
    const itemsByCategory = groupItemsByCategory(list.items);

    return {
        ok: true,
        list,
        items_by_category: itemsByCategory,
        category_order: CATEGORY_ORDER,
        summary: {
            total_items: totalItems,
            purchased_items: purchasedItems,
            pending_items: pendingItems,
            ready_for_fridge: readyForFridge,
        },
    };
}

/**
 * Add items to an existing list
 */
async function addItemsToList(userId, listId, items) {
    await connectMongo();

    const list = await GroceryList.findOne({
        _id: listId,
        user_id: userId,
    });

    if (!list) {
        return {
            ok: false,
            status: 404,
            message: 'Grocery list not found',
        };
    }

    if (list.archived) {
        return {
            ok: false,
            status: 400,
            message: 'Cannot add items to an archived list',
        };
    }

    const normalizedItems = items.map((item) => ({
        name: String(item.name || '').trim(),
        category: item.category ? String(item.category).trim() : undefined,
        quantity: item.quantity ? Number(item.quantity) : undefined,
        unit: item.unit ? String(item.unit).trim() : undefined,
        source: item.source || 'manual',
        source_id: item.source_id ? String(item.source_id) : undefined,
        purchased: false,
        added_to_fridge: false,
    })).filter((item) => item.name);

    if (normalizedItems.length === 0) {
        return {
            ok: false,
            status: 400,
            message: 'At least one item with a name is required',
        };
    }

    list.items.push(...normalizedItems);
    await list.save();

    return {
        ok: true,
        list: list.toObject(),
    };
}

/**
 * Add missing recipe ingredients to an existing list
 */
async function addMissingIngredientsToList(userId, listId, payload) {
    const sourceSurface = String(payload?.sourceSurface || '').trim();
    const recipeId = String(payload?.recipeId || '').trim();
    const recipeTitle = payload?.recipeTitle ? String(payload.recipeTitle).trim() : undefined;
    const mode = String(payload?.mode || '').trim();
    const ingredients = Array.isArray(payload?.ingredients) ? payload.ingredients : [];

    const mappedItems = ingredients.map((ingredientName) => ({
        name: String(ingredientName || '').trim(),
        source: 'recipe',
        source_id: recipeId,
    })).filter((item) => item.name);

    const addResult = await addItemsToList(userId, listId, mappedItems);
    if (!addResult.ok) {
        return addResult;
    }

    return {
        ok: true,
        list: addResult.list,
        added_count: mappedItems.length,
        source_surface: sourceSurface,
        mode,
        recipe: {
            id: recipeId,
            title: recipeTitle,
        },
    };
}

/**
 * Mark item as purchased/unpurchased
 */
async function updateItemPurchaseStatus(userId, listId, itemId, purchased) {
    await connectMongo();

    const list = await GroceryList.findOne({
        _id: listId,
        user_id: userId,
    });

    if (!list) {
        return {
            ok: false,
            status: 404,
            message: 'Grocery list not found',
        };
    }

    const item = list.items.id(itemId);
    if (!item) {
        return {
            ok: false,
            status: 404,
            message: 'Item not found in list',
        };
    }

    item.purchased = Boolean(purchased);
    item.purchased_at = purchased ? new Date() : null;

    await list.save();

    return {
        ok: true,
        list: list.toObject(),
    };
}

/**
 * Bulk update purchase status for multiple items
 */
async function bulkUpdatePurchaseStatus(userId, listId, itemIds, purchased) {
    await connectMongo();

    const list = await GroceryList.findOne({
        _id: listId,
        user_id: userId,
    });

    if (!list) {
        return {
            ok: false,
            status: 404,
            message: 'Grocery list not found',
        };
    }

    let updatedCount = 0;
    for (const itemId of itemIds) {
        const item = list.items.id(itemId);
        if (item) {
            item.purchased = Boolean(purchased);
            item.purchased_at = purchased ? new Date() : null;
            updatedCount += 1;
        }
    }

    await list.save();

    return {
        ok: true,
        list: list.toObject(),
        updated_count: updatedCount,
    };
}

/**
 * Add purchased item to fridge
 */
async function addItemToFridge(userId, listId, itemId, fridgeData) {
    await connectMongo();

    const list = await GroceryList.findOne({
        _id: listId,
        user_id: userId,
    });

    if (!list) {
        return {
            ok: false,
            status: 404,
            message: 'Grocery list not found',
        };
    }

    const item = list.items.id(itemId);
    if (!item) {
        return {
            ok: false,
            status: 404,
            message: 'Item not found in list',
        };
    }

    if (!item.purchased) {
        return {
            ok: false,
            status: 400,
            message: 'Item must be marked as purchased before adding to fridge',
        };
    }

    if (item.added_to_fridge) {
        return {
            ok: false,
            status: 400,
            message: 'Item has already been added to fridge',
        };
    }

    // Validate required fridge data
    if (!fridgeData.expiration_date) {
        return {
            ok: false,
            status: 400,
            message: 'expiration_date is required',
        };
    }

    if (!fridgeData.quantity || fridgeData.quantity <= 0) {
        return {
            ok: false,
            status: 400,
            message: 'quantity is required and must be greater than 0',
        };
    }

    if (!fridgeData.unit) {
        return {
            ok: false,
            status: 400,
            message: 'unit is required',
        };
    }

    // Get user's fridge ID
    const fridgeResult = await resolveFridgeIdForUser(userId);
    if (fridgeResult.status !== 'OK') {
        return {
            ok: false,
            status: 404,
            message: 'User fridge not found',
        };
    }

    // Create fridge item
    const fridgeItem = {
        fridge_id: fridgeResult.fridgeId,
        name: item.name,
        category: item.category || 'Other',
        expiration_date: new Date(fridgeData.expiration_date),
        quantity: Number(fridgeData.quantity),
        unit: String(fridgeData.unit).trim(),
        location: fridgeData.location ? String(fridgeData.location).trim() : undefined,
    };

    try {
        await FridgeItem.create(fridgeItem);
    } catch (err) {
        // Handle duplicate key error (item already exists in fridge)
        if (err.code === 11000) {
            return {
                ok: false,
                status: 409,
                message: 'Item with same name, category, and unit already exists in fridge',
            };
        }
        throw err;
    }

    // Mark item as added to fridge
    item.added_to_fridge = true;
    item.added_to_fridge_at = new Date();
    await list.save();

    return {
        ok: true,
        list: list.toObject(),
        fridge_item: fridgeItem,
    };
}

/**
 * Delete an item from a list
 */
async function deleteItemFromList(userId, listId, itemId) {
    await connectMongo();

    const list = await GroceryList.findOne({
        _id: listId,
        user_id: userId,
    });

    if (!list) {
        return {
            ok: false,
            status: 404,
            message: 'Grocery list not found',
        };
    }

    const item = list.items.id(itemId);
    if (!item) {
        return {
            ok: false,
            status: 404,
            message: 'Item not found in list',
        };
    }

    list.items.pull({ _id: item._id });
    await list.save();

    return {
        ok: true,
        list: list.toObject(),
    };
}

/**
 * Archive a grocery list
 */
async function archiveGroceryList(userId, listId) {
    await connectMongo();

    const list = await GroceryList.findOne({
        _id: listId,
        user_id: userId,
    });

    if (!list) {
        return {
            ok: false,
            status: 404,
            message: 'Grocery list not found',
        };
    }

    list.archived = true;
    list.archived_at = new Date();
    await list.save();

    return {
        ok: true,
        list: list.toObject(),
    };
}

/**
 * Delete a grocery list
 */
async function deleteGroceryList(userId, listId) {
    await connectMongo();

    const result = await GroceryList.deleteOne({
        _id: listId,
        user_id: userId,
    });

    if (result.deletedCount === 0) {
        return {
            ok: false,
            status: 404,
            message: 'Grocery list not found',
        };
    }

    return {
        ok: true,
    };
}

module.exports = {
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
};
