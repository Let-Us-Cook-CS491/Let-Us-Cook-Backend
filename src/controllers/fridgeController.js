const FridgeItem = require('../schemes/fridgeItem');
const { isValidWeightUnit, isValidCategory } = require('../middleware/helperFunctions');
const { connectMongo } = require('../config/databaseConnection');
const { extractReceiptText } = require('../services/receiptOcrService');
const { parseWithGemini } = require('../services/geminiReceiptParser');
const crypto = require('crypto');

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

// INV 1.2: Upload receipt, extract items, update inventory
exports.uploadReceiptToFridge = async (req, res) => {
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

        if (!req.file?.buffer) {
            return res.status(400).json({
                status: "ERROR",
                message: "Receipt file is required (field: receipt)",
            });
        }

        if (!String(req.file?.mimetype || '').startsWith('image/')) {
            return res.status(400).json({
                status: "ERROR",
                message: "Only image receipts are supported right now",
            });
        }

        const ocrText = await extractReceiptText(req.file.buffer);
        if (!ocrText) {
            return res.status(422).json({
                status: "ERROR",
                message: "No text extracted from receipt",
            });
        }

        const { items, skipped } = await parseWithGemini(ocrText);
        if (!items.length) {
            return res.status(422).json({
                status: "ERROR",
                message: "No valid items parsed from receipt",
                skipped,
            });
        }
        
        const receiptId = crypto.randomUUID();

        return res.status(200).json({
            status: "OK",
            message: "Receipt processed. Please confirm items before adding to inventory.",
            data: {
                receiptId,
                extractedTextPreview: ocrText.slice(0, 500),
                items,
                skipped,
            },
        });
    } catch (err) {
        console.error('uploadReceiptToFridge error:', err);
        return res.status(500).json({
            status: "ERROR",
            message: "Failed to process receipt",
        });
    }
};

// INV 1.2: Confirm receipt items and update inventory
exports.confirmReceiptItems = async (req, res) => {
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

        const { items, item, location } = req.body || {};
        const resolvedItems = Array.isArray(items) ? items : (item ? [item] : []);
        if (resolvedItems.length === 0) {
            return res.status(400).json({
                status: "ERROR",
                message: "Send exactly one item (field: item) or an items array with one entry",
            });
        }
        if (resolvedItems.length > 1) {
            return res.status(400).json({
                status: "ERROR",
                message: "Only one item can be confirmed per request",
            });
        }

        const failed = [];
        const upsertedItems = [];

        for (const item of resolvedItems) {
            const normalizedName = String(item?.name || '').trim().toLowerCase();
            const category = item?.category;
            const unit = item?.unit;
            const quantity = item?.quantity;
            const parsedExpiration = new Date(item?.expiration_date);

            if (!normalizedName) {
                failed.push({ item, reason: "Name is required" });
                continue;
            }
            if (!isValidCategory(category)) {
                failed.push({ item, reason: "Invalid category" });
                continue;
            }
            if (!isValidWeightUnit(unit)) {
                failed.push({ item, reason: "Invalid unit" });
                continue;
            }
            if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) {
                failed.push({ item, reason: "Quantity must be greater than 0" });
                continue;
            }
            if (Number.isNaN(parsedExpiration.getTime())) {
                failed.push({ item, reason: "Invalid expiration date" });
                continue;
            }
            if (parsedExpiration.getTime() < Date.now()) {
                failed.push({ item, reason: "Expiration date must be in the future" });
                continue;
            }

            const filter = { user_id, name: normalizedName, category, unit };
            const existing = await FridgeItem.findOne(filter).select({ _id: 1 }).lean();
            const incBy = existing ? 1 : Number(quantity);

            const update = {
                $set: { expiration_date: parsedExpiration },
                $inc: { quantity: incBy },
            };
            if (location) {
                update.$set.location = location;
            }

            const upserted = await FridgeItem.findOneAndUpdate(filter, update, {
                upsert: true,
                returnDocument: 'after',
                setDefaultsOnInsert: true,
            });

            upsertedItems.push(upserted);
        }

        return res.status(200).json({
            status: "OK",
            message: "Receipt items confirmed",
            data: {
                upsertedCount: upsertedItems.length,
                upsertedItems,
                failed,
            },
        });
    } catch (err) {
        console.error('confirmReceiptItems error:', err);
        return res.status(500).json({
            status: "ERROR",
            message: "Failed to confirm receipt items",
        });
    }
};

