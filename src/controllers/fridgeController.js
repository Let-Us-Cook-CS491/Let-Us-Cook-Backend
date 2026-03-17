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
        
        const { name, category, expiration_date, quantity, unit } = req.body;

        if (!name || !category || !expiration_date || quantity === undefined || quantity === null || !unit) {
            return res.status(400).json({
                status: "ERROR",
                message: "All fields are required",
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

        const upsertedFridgeItem = await FridgeItem.findOneAndUpdate(
            { user_id, name, category, unit },
            {
                $set: { expiration_date: parsedExpiration },
                $inc: { quantity: Number(quantity) },
                $setOnInsert: { user_id, name, category, unit },
            },
            {
                upsert: true,
                new: true,
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

