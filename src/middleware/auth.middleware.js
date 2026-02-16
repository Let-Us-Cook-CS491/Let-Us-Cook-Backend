const jwt = require('jsonwebtoken');

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '15m';
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';


const generateAccessToken = (payload) => {
    return jwt.sign(payload, JWT_SECRET, {
        expiresIn: ACCESS_TOKEN_EXPIRY,
    });
};


const generateRefreshToken = (payload) => {
    return jwt.sign(payload, JWT_REFRESH_SECRET, {
        expiresIn: REFRESH_TOKEN_EXPIRY,
    });
};


const generateTokens = (payload) => {
    return {
        accessToken: generateAccessToken(payload),
        refreshToken: generateRefreshToken(payload),
    };
};


const verifyAccessToken = (token) => {
    return jwt.verify(token, JWT_SECRET);
};


const verifyRefreshToken = (token) => {
    return jwt.verify(token, JWT_REFRESH_SECRET);
};


const verifyToken = (req, res, next) => {
    try {
        // Get token from Authorization header (format: "Bearer <token>")
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({
                status: 'ERROR',
                message: 'No authorization header provided',
            });
        }

        const token = authHeader.split(' ')[1]; // Extract token after "Bearer "
        
        if (!token) {
            return res.status(401).json({
                status: 'ERROR',
                message: 'No token provided',
            });
        }

        // Verify and decode the token
        const decoded = verifyAccessToken(token);
        
        // Attach decoded user data to request object
        req.user = decoded;
        
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                status: 'ERROR',
                message: 'Token has expired',
                error: 'TokenExpiredError',
            });
        } else if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                status: 'ERROR',
                message: 'Invalid token',
                error: 'JsonWebTokenError',
            });
        } else {
            return res.status(500).json({
                status: 'ERROR',
                message: 'Token verification failed',
                error: error.message,
            });
        }
    }
};

const refreshAccessToken = (refreshToken) => {
    try {
        // Verify the refresh token
        const decoded = verifyRefreshToken(refreshToken);
        
        // Generate a new access token with the same payload
        const newAccessToken = generateAccessToken({
            user_id: decoded.user_id,
            email: decoded.email,
            ...decoded
        });
        
        return {
            accessToken: newAccessToken,
        };
    } catch (error) {
        throw new Error('Invalid or expired refresh token');
    }
};

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    generateTokens,
    verifyAccessToken,
    verifyRefreshToken,
    verifyToken,
    refreshAccessToken,
};
