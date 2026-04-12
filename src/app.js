const express = require('express');
const cors = require('cors');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const fridgeRoutes = require('./routes/fridge');
const userRoutes = require('./routes/user');
const recipesRoutes = require('./routes/recipes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/fridge', fridgeRoutes);
app.use('/api/user', userRoutes);
app.use('/api/recipes', recipesRoutes);

module.exports = app;
