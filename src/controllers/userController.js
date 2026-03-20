const db = require('../config/databaseConnection');
const UserPreference = require('../schemes/userPreferences');
const { connectMongo } = require('../config/databaseConnection');
const { isValidGoal, isValidActivityLevel } = require('../middleware/helperFunctions');


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

exports.setHealthGoals = async (req, res) => {
    const { goal, activity_level, calorie_target } = req.body;
    let normalized_calorie_target = calorie_target || null

    const rawUserId = req.user?.user_id;
    const user_id = Number(rawUserId);
    if (!Number.isInteger(user_id)) {
        return res.status(401).json({
            status: "ERROR",
            message: "Unauthorized User",
        });
    }

    if (!goal || !activity_level) {
        return res.status(400).json({
            status: "ERROR",
            message: "Goal and Activity Level fields are required",
        });
    }

    if (!isValidGoal(goal)) {
        return res.status(400).json({
            status: "ERROR",
            message: "Invalid goal value",
        });
    }

    if (!isValidActivityLevel(activity_level)) {
        return res.status(400).json({
            status: "ERROR",
            message: "Invalid activity level value",
        });
    }

    try {
        connection = await db.getConnection();

        const updateUserHealthGoalQuery = 
        `INSERT INTO health_goals (user_id, goal, activity_level, calorie_target)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
        goal = VALUES(goal),
        activity_level = VALUES(activity_level),
        calorie_target = VALUES(calorie_target);`;

        const [updateUserHealthGoalResult] = await connection.execute(updateUserHealthGoalQuery, [user_id, goal, activity_level, normalized_calorie_target]);

        if (updateUserHealthGoalResult.length === 0) {
            return res.status(401).json({
                status: "ERROR",
                message: "Failed to insert into Table",
            });
        }

        await connection.commit();

        res.status(200).json({
            status: "OK",
            message: "User health goals set successfully",
        });
    } catch (error) {
        res.status(401).json({
            status: "ERROR",
            message: "Failed to set user health goals",
            error: error.message,
        });
    } finally {
        if (connection) await connection.release();
    }
}