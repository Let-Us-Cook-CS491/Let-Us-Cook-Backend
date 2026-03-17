const mongoose = require('mongoose');

const fridgeItemSchema = new mongoose.Schema(
  {
    user_id: { type: Number, required: true, index: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    expiration_date: { type: Date, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, trim: true },
    location: { type: String, required: false, trim: true },
  },
  {
    collection: 'Inventory',
    timestamps: true,
  }
);

// One item per user per (name, category, unit).
fridgeItemSchema.index(
  { user_id: 1, name: 1, category: 1, unit: 1, location: 1 },
  { unique: true, sparse: true }
);

const FridgeItem =
  mongoose.models.FridgeItem || mongoose.model('FridgeItem', fridgeItemSchema);

module.exports = FridgeItem;
