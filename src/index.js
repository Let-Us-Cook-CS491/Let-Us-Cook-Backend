const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env'), override: false });

const app = require('./app');


process.on('unhandledRejection', (err, promise) => {
    console.error('Unhandled Promise Rejection at:', promise, 'reason:', err);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

const APP_PORT = process.env.APP_PORT;


const server = app.listen(APP_PORT, () => 
    console.log(`Server running on port ${APP_PORT}`)
);

server.on('error', (err) => {
    console.error('Server error:', err);
});

module.exports = server;