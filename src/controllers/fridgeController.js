const FridgeItem = require('../schemes/fridgeItem');
const db = require('../config/databaseConnection');
const { isValidWeightUnit, isValidCategory } = require('../middleware/helperFunctions');
const { connectMongo } = require('../config/databaseConnection');
const { extractReceiptText } = require('../services/receiptOcrService');
const { parseWithGemini } = require('../services/geminiReceiptParser');
const crypto = require('crypto');

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
                message: "name, category, expiration_date, quantity, and unit are required",
            });
        }

        const getUserFridgeQuery = `SELECT fridge_id FROM users WHERE user_id = ?`;
        const [userRows] = await db.execute(getUserFridgeQuery, [user_id]);
        const userFridge = userRows?.[0];
        if (!userFridge) {
            return res.status(404).json({
                status: "ERROR",
                message: "User not found",
            });
        }

        const derivedFridgeId = Number(userFridge.fridge_id);
        if (!Number.isInteger(derivedFridgeId) || derivedFridgeId < 1) {
            return res.status(400).json({
                status: "ERROR",
                message: "User does not have a valid fridge",
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

        const filter = { fridge_id: derivedFridgeId, name: normalizedName, category, unit };

        const existingItem = await FridgeItem.findOne(filter, { expiration_date: 1 }).lean();

        const update = {
            $inc: { quantity: Number(quantity) },
        };

        // Only move expiration earlier (closer to expiring); never push it later.
        if (!existingItem?.expiration_date || parsedExpiration.getTime() < new Date(existingItem.expiration_date).getTime()) {
            update.$set = { expiration_date: parsedExpiration };
        }

        // Only add location if it's provided ($set may be absent if expiration was not updated)
        if (location) {
            if (!update.$set) update.$set = {};
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
        ).lean();

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

        const { item_id, count } = req.body;

        if (!item_id) {
            return res.status(400).json({
                status: "ERROR",
                message: "item_id is required",
            });
        }

        const removeCount = Number(count ?? 1);
        if (!Number.isFinite(removeCount) || removeCount <= 0) {
            return res.status(400).json({
                status: "ERROR",
                message: "count must be a number greater than 0",
            });
        }

        const getUserFridgeQuery = `SELECT fridge_id FROM users WHERE user_id = ?`;
        const [userRows] = await db.execute(getUserFridgeQuery, [user_id]);
        const userFridge = userRows?.[0];
        if (!userFridge) {
            return res.status(404).json({
                status: "ERROR",
                message: "User not found",
            });
        }

        const derivedFridgeId = Number(userFridge.fridge_id);
        if (!Number.isInteger(derivedFridgeId) || derivedFridgeId < 1) {
            return res.status(400).json({
                status: "ERROR",
                message: "User does not have a valid fridge",
            });
        }

        const existing = await FridgeItem.findOne({ fridge_id: derivedFridgeId, _id: item_id }).lean();
        if (!existing) {
            return res.status(404).json({
                status: "ERROR",
                message: "Item not found",
            });
        }

        const newQuantity = Number(existing.quantity) - removeCount;
        if (newQuantity <= 0) {
            await FridgeItem.deleteOne({ fridge_id: derivedFridgeId, _id: item_id });
            return res.status(200).json({
                status: "OK",
                message: "Item removed from fridge",
            });
        }

        const updated = await FridgeItem.findOneAndUpdate(
            { fridge_id: derivedFridgeId, _id: item_id },
            { $set: { quantity: newQuantity } },
            { returnDocument: 'after' }
        ).lean();

        return res.status(200).json({
            status: "OK",
            message: "Item quantity updated",
            data: updated,
        });
    } catch (err) {
        console.error('removeItemFromFridge error:', err);
        return res.status(500).json({
            status: "ERROR",
            message: "Failed to remove item from fridge",
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

        const getUserFridgeQuery = `SELECT fridge_id FROM users WHERE user_id = ?`;
        const [userRows] = await db.execute(getUserFridgeQuery, [user_id]);
        const userFridge = userRows?.[0];
        if (!userFridge) {
            return res.status(404).json({
                status: "ERROR",
                message: "User not found",
            });
        }

        const derivedFridgeId = Number(userFridge.fridge_id);
        if (!Number.isInteger(derivedFridgeId) || derivedFridgeId < 1) {
            return res.status(400).json({
                status: "ERROR",
                message: "User does not have a valid fridge",
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
            { fridge_id: derivedFridgeId, _id: item_id },
            { $set: updateFields },
            { returnDocument: 'after' }
        ).lean();

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
        const rawLimit = req.query?.limit;
        const rawSkip = req.query?.skip;
        const rawExpiringInDays = req.query?.expiringInDays;

        const skip = Math.max(Number(rawSkip) || 0, 0);

        const filter = { user_id };
        if (category !== undefined && category !== null && String(category).trim() !== '') {
            filter.category = String(category).trim();
        }

        const expiringInDays = Number(rawExpiringInDays);
        let expiryWindowApplied = false;
        if (Number.isFinite(expiringInDays) && expiringInDays > 0) {
            const windowDays = Math.min(30, Math.max(1, Math.floor(expiringInDays)));
            const now = new Date();
            const upper = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
            filter.expiration_date = { $lte: upper };
            expiryWindowApplied = true;
        }

        const sort = expiryWindowApplied
            ? { expiration_date: 1, name: 1 }
            : filter.category
                ? { expiration_date: 1, name: 1 }
                : { category: 1, expiration_date: 1, name: 1 };

        const defaultLimit = expiryWindowApplied ? 200 : 50;
        const limit = Math.min(Math.max(Number(rawLimit) || defaultLimit, 1), 200);

        const items = await FridgeItem
            .find(filter, { __v: 0 })
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean();

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

exports.createFridgeInvite = async (req, res) => {
    let connection;
    try {
        const user_id = Number(req.user?.user_id);
        const fridge_id = Number(req.params?.fridgeId);

        if (!Number.isInteger(user_id)) {
            return res.status(401).json({
                status: "ERROR",
                message: "Unauthorized",
            });
        }

        if (!Number.isInteger(fridge_id) || fridge_id < 1) {
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid fridgeId",
            });
        }

        connection = await db.getConnection();
        await connection.beginTransaction();

        const verifyOwnershipQuery = `SELECT fridge_id FROM users WHERE user_id = ? LIMIT 1`;
        const [ownerRows] = await connection.execute(verifyOwnershipQuery, [user_id]);
        if (ownerRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                status: "ERROR",
                message: "User not found",
            });
        }

        if (Number(ownerRows[0].fridge_id) !== fridge_id) {
            await connection.rollback();
            return res.status(403).json({
                status: "ERROR",
                message: "You can only create invites for your own fridge",
            });
        }

        const invite_code = crypto.randomBytes(6).toString('hex');
        const insertInviteQuery = `
            INSERT INTO fridge_invites (fridge_id, invite_code, created_by, expires_at, used_at)
            VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY), NULL)
        `;
        const [insertInviteResult] = await connection.execute(insertInviteQuery, [
            fridge_id,
            invite_code,
            user_id,
        ]);

        if (insertInviteResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(500).json({
                status: "ERROR",
                message: "Failed to create invite",
            });
        }

        await connection.commit();
        return res.status(201).json({
            status: "OK",
            message: "Invite created",
            data: {
                invite_code,
            },
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('createFridgeInvite error:', err);
        return res.status(500).json({
            status: "ERROR",
            message: "Failed to create fridge invite",
        });
    } finally {
        if (connection) await connection.release();
    }
};

exports.joinFridgeByInvite = async (req, res) => {
    let connection;
    try {
        const user_id = Number(req.user?.user_id);
        const invite_code = String(req.body?.invite_code || '').trim();

        if (!Number.isInteger(user_id)) {
            return res.status(401).json({
                status: "ERROR",
                message: "Unauthorized",
            });
        }

        if (!invite_code) {
            return res.status(400).json({
                status: "ERROR",
                message: "invite_code is required",
            });
        }

        connection = await db.getConnection();
        await connection.beginTransaction();

        const findInviteQuery = `
            SELECT invite_id, fridge_id, used_at, expires_at
            FROM fridge_invites
            WHERE invite_code = ?
            LIMIT 1
            FOR UPDATE
        `;
        const [inviteRows] = await connection.execute(findInviteQuery, [invite_code]);

        if (inviteRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                status: "ERROR",
                message: "Invite code not found",
            });
        }

        const invite = inviteRows[0];
        if (invite.used_at) {
            await connection.rollback();
            return res.status(409).json({
                status: "ERROR",
                message: "Invite code has already been used",
            });
        }

        if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
            await connection.rollback();
            return res.status(410).json({
                status: "ERROR",
                message: "Invite code has expired",
            });
        }

        const findUserFridgeQuery = `
            SELECT fridge_id
            FROM users
            WHERE user_id = ?
            LIMIT 1
            FOR UPDATE
        `;
        const [userRows] = await connection.execute(findUserFridgeQuery, [user_id]);
        if (userRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                status: "ERROR",
                message: "User not found",
            });
        }

        if (Number(userRows[0].fridge_id) === Number(invite.fridge_id)) {
            await connection.rollback();
            return res.status(409).json({
                status: "ERROR",
                message: "You are already in this fridge",
            });
        }

        const previousFridgeId = Number(userRows[0].fridge_id);

        const updateUserFridgeQuery = `
            UPDATE users
            SET fridge_id = ?
            WHERE user_id = ?
        `;
        const [userUpdateResult] = await connection.execute(updateUserFridgeQuery, [
            invite.fridge_id,
            user_id,
        ]);

        if (userUpdateResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({
                status: "ERROR",
                message: "User not found",
            });
        }

        const markInviteUsedQuery = `
            UPDATE fridge_invites
            SET used_at = NOW()
            WHERE invite_id = ?
        `;
        await connection.execute(markInviteUsedQuery, [invite.invite_id]);

            const countUsersInOldFridgeQuery = `
                SELECT COUNT(*) AS user_count
                FROM users
                WHERE fridge_id = ?
            `;
            const [countRows] = await connection.execute(countUsersInOldFridgeQuery, [previousFridgeId]);
            const remainingUsers = Number(countRows?.[0]?.user_count || 0);

            if (remainingUsers === 0) {
                const deleteOldFridgeQuery = `
                    DELETE FROM fridge
                    WHERE fridge_id = ?
                `;
                await connection.execute(deleteOldFridgeQuery, [previousFridgeId]);
            }

        await connection.commit();
        return res.status(200).json({
            status: "OK",
            message: "Joined fridge successfully",
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('joinFridgeByInvite error:', err);
        return res.status(500).json({
            status: "ERROR",
            message: "Failed to join fridge",
        });
    } finally {
        if (connection) await connection.release();
    }
};




