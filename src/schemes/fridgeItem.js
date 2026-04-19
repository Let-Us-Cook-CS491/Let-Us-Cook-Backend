const mongoose = require('mongoose');

const fridgeItemSchema = new mongoose.Schema(
  {
    fridge_id: { type: Number, required: true, index: true },
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

// One item per fridge per (name, category, unit).
fridgeItemSchema.index(
  { fridge_id: 1, name: 1, category: 1, unit: 1 },
  { unique: true }
);

// Indexes to speed up getUserFridge filters + sorts.
fridgeItemSchema.index({ fridge_id: 1, expiration_date: 1, name: 1 });
fridgeItemSchema.index({ fridge_id: 1, category: 1, expiration_date: 1, name: 1 });

const FridgeItem =
  mongoose.models.FridgeItem || mongoose.model('FridgeItem', fridgeItemSchema);

module.exports = FridgeItem;
