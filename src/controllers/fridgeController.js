const FridgeItem = require('../schemes/fridgeItem');
const { isValidWeightUnit, isValidCategory } = require('../middleware/helperFunctions');
const { connectMongo } = require('../config/databaseConnection');

// Health Check
exports.addItemToFridge = async (req, res) => {
    try {
        await connectMongo();

        const rawUserId = req.user?.user_id;
        const user_id = Number(rawUserId);
        if (!Number.isInteger(user_id)) {
            return res.status(401).json({
                status: "ERROR",
                message: "Unauthorized",
            });
        }
        
        const { name, category, expiration_date, quantity, unit, location } = req.body;

        if (!name || !category || !expiration_date || quantity === undefined || quantity === null || !unit) {
            return res.status(400).json({
                status: "ERROR",
                message: "All fields are required",
            });
        }

        const normalizedName = String(name).trim().toLowerCase();
        if (!normalizedName) {
            return res.status(400).json({
                status: "ERROR",
                message: "Name is required",
            });
        }

        const parsedExpiration = new Date(expiration_date);
        if (Number.isNaN(parsedExpiration.getTime())) {
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid expiration date",
            });
        }

        if (Number(quantity) <= 0) {
            return res.status(400).json({
                status: "ERROR",
                message: "Quantity must be greater than 0",
            });
        }

        if (parsedExpiration.getTime() < Date.now()) {
            return res.status(400).json({
                status: "ERROR",
                message: "Expiration date must be in the future",
            });
        }

        if (!isValidWeightUnit(unit)) {
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid unit",
            });
        }

        if (!isValidCategory(category)) {
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid category",
            });
        }

        const filter = { user_id, name: normalizedName, category, unit };

        const update = {
            $set: { expiration_date: parsedExpiration },
            $inc: { quantity: Number(quantity) },
          };
          
          // Only add location if it's provided
          if (location) {
            update.$set.location = location;
          }
          
        const upsertedFridgeItem = await FridgeItem.findOneAndUpdate(
            filter,
            update,
            {
              upsert: true,                 // create if not found
              returnDocument: 'after',      // return the updated document
              setDefaultsOnInsert: true,
            }
          );

        return res.status(200).json({
            status: "OK",
            message: "Item upserted in fridge",
            data: upsertedFridgeItem,
        });
    } catch (err) {
        console.error('addItemToFridge error:', err);
        return res.status(500).json({
            status: "ERROR",
            message: "Failed to add item to fridge",
        });
    }
};

exports.removeItemFromFridge = async (req, res) => {
    try {
        await connectMongo();

        const rawUserId = req.user?.user_id;
        const user_id = Number(rawUserId);
        if (!Number.isInteger(user_id)) {
            return res.status(401).json({
                status: "ERROR",
                message: "Unauthorized User",
            });
        }
        
        const { item_id } = req.body;

        if (!item_id) {
            return res.status(400).json({
                status: "ERROR",
                message: "item_id is required",
            });
        }

        const deletedFridgeItem = await FridgeItem.deleteOne({ user_id, _id: item_id });

        if (deletedFridgeItem.deletedCount === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Item not found",
            });
        }

        return res.status(200).json({
            status: "OK",
            message: "Item removed from fridge",
        });
    } catch (err) {
        console.error('deletedFridgeItem error:', err);
        return res.status(500).json({
            status: "ERROR",
            message: "Failed to delete item from fridge",
        });
    }
};        

exports.updateItemInFridge = async (req, res) => {
    try {
        await connectMongo();

        const rawUserId = req.user?.user_id;
        const user_id = Number(rawUserId);
        if (!Number.isInteger(user_id)) {
            return res.status(401).json({
                status: "ERROR",
                message: "Unauthorized User",
            });
        }
        
        const { item_id, name, category, expiration_date, quantity, unit, location } = req.body;

        if (!item_id) {
            return res.status(400).json({
                status: "ERROR",
                message: "item_id is required",
            });
        }

        const updateFields = {};

        if (name !== undefined) {
            const normalizedName = String(name).trim().toLowerCase();
            if (!normalizedName) {
                return res.status(400).json({
                    status: "ERROR",
                    message: "Invalid name",
                });
            }
            updateFields.name = normalizedName;
        }

        if (category !== undefined) {
            if (!isValidCategory(category)) {
                return res.status(400).json({
                    status: "ERROR",
                    message: "Invalid category",
                });
            }
            updateFields.category = category;
        }

        if (unit !== undefined) {
            if (!isValidWeightUnit(unit)) {
                return res.status(400).json({
                    status: "ERROR",
                    message: "Invalid unit",
                });
            }
            updateFields.unit = unit;
        }

        if (expiration_date !== undefined) {
            const parsedExpiration = new Date(expiration_date);
            if (Number.isNaN(parsedExpiration.getTime())) {
                return res.status(400).json({
                    status: "ERROR",
                    message: "Invalid expiration date",
                });
            }
            updateFields.expiration_date = parsedExpiration;
        }

        if (quantity !== undefined) {
            const q = Number(quantity);
            if (!Number.isFinite(q) || q < 0) {
                return res.status(400).json({
                    status: "ERROR",
                    message: "Invalid quantity",
                });
            }
            updateFields.quantity = q;
        }

        if (location !== undefined) {
            const normalizedLocation =
                typeof location === 'string' ? location.trim() : '';
            // allow clearing location by passing "" (empty string)
            updateFields.location = normalizedLocation;
        }

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({
                status: "ERROR",
                message: "No fields provided to update",
            });
        }

        const updatedFridgeItem = await FridgeItem.findOneAndUpdate(
            { user_id, _id: item_id },
            { $set: updateFields },
            { returnDocument: 'after' }
        );

        if (!updatedFridgeItem) {
            return res.status(404).json({
                status: "ERROR",
                message: "Item not found",
            });
        }

        return res.status(200).json({
            status: "OK",
            message: "Item updated",
            data: updatedFridgeItem,
        });
    } catch (err) {
        if (err?.code === 11000) {
            return res.status(409).json({
                status: "ERROR",
                message: "Update would create a duplicate item",
            });
        }

        console.error('updateItemInFridge error:', err);
        return res.status(500).json({
            status: "ERROR",
            message: "Failed to update item from fridge",
        });
    }
};   

exports.getUserFridge = async (req, res) => {
    try {
        await connectMongo();

        const rawUserId = req.user?.user_id;
        const user_id = Number(rawUserId);
        if (!Number.isInteger(user_id)) {
            return res.status(401).json({
                status: "ERROR",
                message: "Unauthorized User",
            });
        }
        
        const category = req.query?.category;

        const filter = { user_id };
        if (category !== undefined && category !== null && String(category).trim() !== '') {
            filter.category = String(category).trim();
        }

        const sort = filter.category
            ? { expiration_date: 1, name: 1 }
            : { category: 1, expiration_date: 1, name: 1 };

        const items = await FridgeItem.find(filter).sort(sort).lean();

        return res.status(200).json({
            status: "OK",
            message: "Fridge items fetched",
            data: items,
        });
    } catch (err) {
        console.error('getUserFridge error:', err);
        return res.status(500).json({
            status: "ERROR",
            message: "Failed to fetch fridge items",
        });
    }
};       


