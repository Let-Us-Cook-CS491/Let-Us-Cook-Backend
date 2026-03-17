const UserPreference = require('../schemes/userPreferences');
const { connectMongo } = require('../config/databaseConnection');

exports.setUserPreference = async (req, res) => {
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
        
        const { current_diet, restrictions, smart_alerts } = req.body || {};
        const normalized_diet = String(current_diet ?? '').trim() || 'Everything';

        const updateFields = {};

        updateFields.current_diet = normalized_diet;

        if (restrictions !== undefined) {
            if (!Array.isArray(restrictions)) {
                return res.status(400).json({
                    status: "ERROR",
                    message: "restrictions must be an array of strings",
                });
            }
            updateFields.restrictions = restrictions.map((r) => String(r).trim()).filter(Boolean);
        }

        if (smart_alerts !== undefined) {
            if (typeof smart_alerts !== 'object' || smart_alerts === null || Array.isArray(smart_alerts)) {
                return res.status(400).json({
                    status: "ERROR",
                    message: "smart_alerts must be an object",
                });
            }

            if (smart_alerts.waste_prevention !== undefined) {
                updateFields['smart_alerts.waste_prevention'] = Boolean(smart_alerts.waste_prevention);
            }
            if (smart_alerts.kitchen_briefing !== undefined) {
                updateFields['smart_alerts.kitchen_briefing'] = Boolean(smart_alerts.kitchen_briefing);
            }
        }

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({
                status: "ERROR",
                message: "No preferences provided",
            });
        }

        const updatedPreferences = await UserPreference.findOneAndUpdate(
            { user_id },
            { $set: updateFields, $setOnInsert: { user_id } },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        ).lean();

        return res.status(200).json({
            status: "OK",
            message: "Preferences saved",
            data: updatedPreferences,
        });
    } catch (err) {
        console.error('setUserPreference error:', err);
        return res.status(500).json({
            status: "ERROR",
            message: "Failed to save preferences",
        });
    }
};     