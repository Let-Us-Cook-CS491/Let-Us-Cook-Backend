const mysql = require('mysql2');
const mongoose = require('mongoose');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || '',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const db = pool.promise();

pool.on('error', (err) => {
    console.error('MySQL pool error:', err.code);
});

setTimeout(async () => {
    try {
      await db.query('SELECT 1'); 
      console.log('Database connected successfully');
    } catch (err) {
      console.error('Database connection failed:', err.code);
      process.exit(1);
    }
  }, 5000);


let mongoConnectPromise = null;

async function connectMongo() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }

  if (!mongoConnectPromise) {
    mongoConnectPromise = mongoose.connect(uri);
  }

  await mongoConnectPromise;
  return mongoose.connection;
}

mongoose.connection.on('connected', () => {
  console.log('MongoDB connected');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err?.message || err);
});

// Backwards-compatible default export (MySQL).
module.exports = db;
// Named exports for Mongo usage.
module.exports.connectMongo = connectMongo;
module.exports.mongoose = mongoose;
