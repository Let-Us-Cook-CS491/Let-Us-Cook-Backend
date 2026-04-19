const mongoose = require('mongoose');

/**
 * One document per user per week (unique compound index).
 * days[].slots: { breakfast, lunch, dinner } — each null or a plain object (see weeklyMealPlanService).
 */
const mealPlanSchema = new mongoose.Schema(
  {
    user_id: { type: Number, required: true },
    week_start: { type: Date, required: true },
    days: {
      type: [
        {
          date: { type: Date, required: true },
          slots: { type: mongoose.Schema.Types.Mixed, required: true },
        },
      ],
    },
  },
  {
    collection: 'MealPlans',
    timestamps: true,
  }
);

mealPlanSchema.index({ user_id: 1, week_start: 1 }, { unique: true });
mealPlanSchema.index({ user_id: 1, updatedAt: -1 });

const MealPlan = mongoose.models.MealPlan || mongoose.model('MealPlan', mealPlanSchema);

module.exports = MealPlan;
