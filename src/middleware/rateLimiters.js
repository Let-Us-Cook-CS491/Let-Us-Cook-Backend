const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.API_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
});

const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.API_STRICT_RATE_LIMIT,
    message: 'Too many requests, slow down',
});

module.exports = { apiLimiter, strictLimiter };