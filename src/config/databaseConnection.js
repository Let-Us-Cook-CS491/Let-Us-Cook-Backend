const mysql = require('mysql2');

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

module.exports = db;
