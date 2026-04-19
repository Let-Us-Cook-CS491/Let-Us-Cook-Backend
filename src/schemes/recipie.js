const mongoose = require('mongoose');

/**
 * Mongo collection name in Atlas is spelled "Recipies" (legacy).
 * strict: false allows fields not declared here (e.g. image URLs) to pass through.
 */
const ingredientItemSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    measure: { type: String, trim: true },
  },
  { _id: false, strict: false }
);

const recipieSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    /** TheMealDB id when this document caches an external meal (RMG 1.1). */
    idMeal: { type: String, trim: true, sparse: true },
    /** Full lookup.php meal payload for nutrition + ingredient parsing without re-hitting MealDB. */
    mealdb_full: { type: mongoose.Schema.Types.Mixed },
    recipe_source: { type: String, trim: true },
    ingredients: { type: [ingredientItemSchema], default: [] },
    nutrition: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    tags: { type: [String], default: [] },
  },
  {
    collection: 'Recipies',
    strict: false,
    timestamps: true,
  }
);

recipieSchema.index({ title: 1 });
recipieSchema.index({ idMeal: 1 }, { unique: true, sparse: true });

const Recipie = mongoose.models.Recipie || mongoose.model('Recipie', recipieSchema);

module.exports = Recipie;
