const mongoose = require('mongoose');

const groceryItemSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        category: { type: String, trim: true },
        quantity: { type: Number, min: 0 },
        unit: { type: String, trim: true },
        source: { type: String, enum: ['recipe', 'meal_plan', 'manual'], default: 'manual' },
        source_id: { type: String, trim: true },
        purchased: { type: Boolean, default: false },
        purchased_at: { type: Date },
        added_to_fridge: { type: Boolean, default: false },
        added_to_fridge_at: { type: Date },
    },
    { _id: true }
);

const groceryListSchema = new mongoose.Schema(
    {
        user_id: { type: Number, required: true, index: true },
        name: { type: String, trim: true, default: 'Shopping List' },
        items: { type: [groceryItemSchema], default: [] },
        archived: { type: Boolean, default: false, index: true },
        archived_at: { type: Date },
    },
    {
        collection: 'GroceryLists',
        timestamps: true,
    }
);

// Index for listing user's active/archived lists
groceryListSchema.index({ user_id: 1, archived: 1, createdAt: -1 });

const GroceryList =
    mongoose.models.GroceryList || mongoose.model('GroceryList', groceryListSchema);

module.exports = GroceryList;
