const db = require('../config/databaseConnection');
const bcrypt = require('bcrypt');
const { generateTokens, verifyRefreshToken, generateAccessToken } = require('../middleware/auth.middleware');
const { isValidTimeZone } = require('../middleware/helperFunctions');


exports.signup = async (req, res) => {
    const { email, password, full_name, phone_number, gender, time_zone } = req.body;
    let phoneNumber = phone_number;

    // Validate required fields
    if (!email || !password || !full_name || !phone_number || !gender || !time_zone) {
        return res.status(400).json({
            status: "ERROR",
            message: "Email, password, full name, phone number, gender, and time zone are required",
        });
    }

    // Validate full name
    if (full_name.length < 3) {
        return res.status(400).json({
            status: "ERROR",
            message: "Full name must be at least 3 characters",
        });
    }

    // Validate phone number
    if (phone_number && phone_number.length !== 10) {
        return res.status(400).json({
            status: "ERROR",
            message: "Phone number must be 10 digits",
        });
    }

    if (!phone_number) {
        phoneNumber = "";
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({
            status: "ERROR",
            message: "Invalid email format",
        });
    }

    // Validate password length
    if (password.length < 6) {
        return res.status(400).json({
            status: "ERROR",
            message: "Password must be at least 6 characters",
        });
    }

    // Validate time zone
    if (!isValidTimeZone(time_zone)) {
        return res.status(400).json({
            status: "ERROR",
            message: "Invalid time zone",
        });
    }

    let connection;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // Check if user already exists
        const checkUserQuery = `SELECT * FROM users WHERE email = ?`;
        const [existingUser] = await connection.execute(checkUserQuery, [email]);

        if (existingUser.length > 0) {
            await connection.rollback();
            return res.status(409).json({
                status: "ERROR",
                message: "User with this email already exists",
            });
        }

        // Hash the password
        const saltRounds = process.env.SALT_ROUNDS || 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Insert new user
        const insertUserQuery = `INSERT INTO users (full_name, email, phone, gender, time_zone) VALUES (?, ?, ?, ?, ?)`;
        const [insertUserResult] = await connection.execute(insertUserQuery, [full_name, email, phoneNumber, gender, time_zone]);

        if (insertUserResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(500).json({
                status: "ERROR",
                message: "Failed to insert user",
            });
        }

        const userId = insertUserResult.insertId;

        // Insert password hash
        const insertAuthQuery = `INSERT INTO auth_credentials (user_id, password_hash) VALUES (?, ?)`;
        const [insertAuthResult] = await connection.execute(insertAuthQuery, [userId, hashedPassword]);

        if (insertAuthResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(500).json({
                status: "ERROR",
                message: "Failed to insert password hash",
            });
        }

        const insertLoginEventQuery = `INSERT INTO logins (user_id) VALUES (?)`;
        const [insertLoginEventResult] = await connection.execute(insertLoginEventQuery, [userId]);

        if (insertLoginEventResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(500).json({
                status: "ERROR",
                message: "Failed to insert login event",
            });
        }

        await connection.commit();

        // Generate tokens
        const tokens = generateTokens({
            user_id: userId,
            email: email
        });

        // Update User's Stored refresh token
        const updateUserRefreshTokenQuery = `UPDATE auth_credentials SET refresh_token = ? WHERE user_id = ?`;
        const [updateUserRefreshTokenResult] = await connection.execute(updateUserRefreshTokenQuery, [tokens.refreshToken, userId]);

        if (updateUserRefreshTokenResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(500).json({
                status: "ERROR",
                message: "Failed to update user refresh token",
            });
        }

        // Commit transaction
        await connection.commit();

        res.status(201).json({
            status: "OK",
            message: "User registered successfully",
            data: {
                user_id: userId,
                email: email,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
            },
        });
    } catch (error) {
        if (connection) await connection.rollback();
        res.status(500).json({
            status: "ERROR",
            message: "Failed to register user",
            error: error.message,
        });
    } finally {
        if (connection) await connection.release();
    }
}

exports.login = async (req, res) => {
    const { email, password, time_zone } = req.body;

    // Validate required fields
    if (!email || !password || !time_zone) {
        return res.status(400).json({
            status: "ERROR",
            message: "Email and password are required",
        });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({
            status: "ERROR",
            message: "Invalid email format",
        });
    }

     // Validate time zone
    if (!isValidTimeZone(time_zone)) {
        return res.status(400).json({
            status: "ERROR",
            message: "Invalid time zone",
        });
    }


    let connection;

    try {
        connection = await db.getConnection();

        // Find user by email
        const findUserQuery = `SELECT user_id, email FROM users WHERE email = ?`;
        const [userResult] = await connection.execute(findUserQuery, [email]);

        if (userResult.length === 0) {
            return res.status(401).json({
                status: "ERROR",
                message: "Invalid email or password",
            });
        }

        const user = userResult[0];

        // Get password hash from authentication table
        const getPasswordQuery = `SELECT password_hash FROM auth_credentials WHERE user_id = ?`;
        const [authResult] = await connection.execute(getPasswordQuery, [user.user_id]);

        if (authResult.length === 0) {
            return res.status(401).json({
                status: "ERROR",
                message: "Invalid email or password",
            });
        }

        // Compare password with hash
        const isPasswordValid = await bcrypt.compare(password, authResult[0].password_hash);

        if (!isPasswordValid) {
            return res.status(401).json({
                status: "ERROR",
                message: "Invalid email or password",
            });
        }

        // Update user time zone
        const updateUserTimeZoneQuery = `UPDATE users SET time_zone = ? WHERE user_id = ?`;
        const [updateUserTimeZoneResult] = await connection.execute(updateUserTimeZoneQuery, [time_zone, user.user_id]);

        if (updateUserTimeZoneResult.affectedRows === 0) {
            return res.status(500).json({
                status: "ERROR",
                message: "Failed to update user time zone",
            });
        }

        // Generate tokens
        const tokens = generateTokens({
            user_id: user.user_id,
            email: user.email
        });

        // Update User's Stored refresh token
        const updateUserRefreshTokenQuery = `UPDATE auth_credentials SET refresh_token = ? WHERE user_id = ?`;
        const [updateUserRefreshTokenResult] = await connection.execute(updateUserRefreshTokenQuery, [tokens.refreshToken, user.user_id]);

        if (updateUserRefreshTokenResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(500).json({
                status: "ERROR",
                message: "Failed to update user refresh token",
            });
        }

        await connection.commit();

        res.status(200).json({
            status: "OK",
            message: "Login successful",
            data: {
                user_id: user.user_id,
                email: user.email,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
            },
        });
    } catch (error) {
        res.status(500).json({
            status: "ERROR",
            message: "Login failed",
            error: error.message,
        });
    } finally {
        if (connection) await connection.release();
    }
}

exports.logout = async (req, res) => {
    const { user_id } = req.body;

    if (!user_id) {
        return res.status(400).json({
            status: "ERROR",
            message: "User ID is required",
        });
    }

    let connection; 

    try {
        connection = await db.getConnection();

        await connection.beginTransaction();

        // Find user by email
        const findUserQuery = `SELECT user_id FROM users WHERE user_id = ?`;
        const [userResult] = await connection.execute(findUserQuery, [user_id]);

        if (userResult.length === 0) {
            await connection.rollback();
            return res.status(401).json({
                status: "ERROR",
                message: "User does not exist",
            });
        }

        // Update User's Stored refresh token
        const updateUserRefreshTokenQuery = `UPDATE auth_credentials SET refresh_token = NULL WHERE user_id = ?`;
        const [updateUserRefreshTokenResult] = await connection.execute(updateUserRefreshTokenQuery, [user_id]);

        if (updateUserRefreshTokenResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(500).json({
                status: "ERROR",
                message: "Failed to update user refresh token",
            });
        }


        // Commit transaction
        await connection.commit();

        res.status(200).json({
            status: "OK",
            message: "Logout successful",
        });

    } catch (error) {
        if (connection) await connection.rollback();
        res.status(500).json({
            status: "ERROR",
            message: "Logout failed",
            error: error.message,
        });
    } finally {
        if (connection) await connection.release();
    }
}
exports.refreshToken = async (req, res) => {
    const { refreshToken, user_id } = req.body;

    if (!refreshToken) {
        return res.status(400).json({
            status: "ERROR",
            message: "Refresh token is required",
        });
    }

    let connection; 

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // Verify the refresh token
        const decoded = verifyRefreshToken(refreshToken);

        // Validate user ID
        if (decoded.user_id !== user_id) {
            return res.status(401).json({
                status: "ERROR",
                message: "Unauthorized: Invalid User ID for this refresh token",
            });
        }

        const validRefreshTokenQuery = `SELECT refresh_token FROM auth_credentials WHERE user_id = ?`;
        const [validRefreshTokenResult] = await connection.execute(validRefreshTokenQuery, [user_id]);

        if (validRefreshTokenResult.length === 0) {
            await connection.rollback();
            return res.status(401).json({
                status: "ERROR",
                message: "No refresh token found for this user",
            });
        }

        if (validRefreshTokenResult[0].refresh_token !== refreshToken) {
            await connection.rollback();
            return res.status(401).json({
                status: "ERROR",
                message: "Invalid or Expired refresh token",
            });
        }

        // Generate a new access token
        const newAccessToken = generateAccessToken({
            user_id: decoded.user_id,
            email: decoded.email,
        });

        res.status(200).json({
            status: "OK",
            message: "Token refreshed successfully",
            accessToken: newAccessToken
        });
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                status: "ERROR",
                message: "Refresh token has expired",
            });
        }
        res.status(401).json({
            status: "ERROR",
            message: "Invalid refresh token",
            error: error.message,
        });
    }
}