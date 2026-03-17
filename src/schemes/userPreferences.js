const mongoose = require('mongoose');

const userPreferenceSchema = new mongoose.Schema(
  {
    user_id: { type: Number, required: true },
    current_diet: { type: String, default: 'Everything', trim: true },
    restrictions: { type: [String], default: [] },
    smart_alerts: {
      waste_prevention: { type: Boolean, default: false },
      kitchen_briefing: { type: Boolean, default: false },
    },
  },
  {
    collection: 'UserPreferences',
    timestamps: true,
  }
);

userPreferenceSchema.index(
  { user_id: 1 },
  { unique: true }
);

const UserPreference =
  mongoose.models.UserPreference || mongoose.model('UserPreference', userPreferenceSchema);

module.exports = UserPreference;
