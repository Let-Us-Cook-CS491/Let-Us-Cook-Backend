const express = require('express');
const cors = require('cors');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);

module.exports = app;
