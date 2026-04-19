const mongoose = require('mongoose');

const nutritionPer100gSchema = new mongoose.Schema(
  {
    calories_kcal: { type: Number, default: 0 },
    protein_g: { type: Number, default: 0 },
    fat_g: { type: Number, default: 0 },
    carbohydrates_g: { type: Number, default: 0 },
    fiber_g: { type: Number, default: 0 },
  },
  { _id: false }
);

const macrosSchema = new mongoose.Schema(
  {
    mealdb_name: { type: String, required: true, trim: true },
    nutrition_values_per_100g: { type: nutritionPer100gSchema, default: () => ({}) },
    source: { type: String, trim: true },
  },
  {
    collection: 'Macros',
    strict: false,
    timestamps: false,
  }
);

macrosSchema.index({ mealdb_name: 1 });

const Macro = mongoose.models.Macro || mongoose.model('Macro', macrosSchema);

module.exports = Macro;
