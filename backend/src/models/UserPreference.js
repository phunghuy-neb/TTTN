import mongoose from 'mongoose'

const RangeSchema = new mongoose.Schema(
  {
    min: { type: Number, min: 0, default: null },
    max: { type: Number, min: 0, default: null },
    target: { type: Number, min: 0, default: null },
  },
  { _id: false }
)

const DurationRangeSchema = new mongoose.Schema(
  {
    minDays: { type: Number, min: 1, max: 60, default: null },
    maxDays: { type: Number, min: 1, max: 60, default: null },
    targetDays: { type: Number, min: 1, max: 60, default: null },
  },
  { _id: false }
)

const UserPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    travelStyles: [{ type: String, trim: true, maxlength: 80 }],
    dislikedTravelStyles: [{ type: String, trim: true, maxlength: 80 }],
    preferredRegions: [{ type: String, trim: true, maxlength: 80 }],
    dislikedRegions: [{ type: String, trim: true, maxlength: 80 }],
    preferredDestinations: [{ type: String, trim: true, maxlength: 120 }],
    dislikedDestinations: [{ type: String, trim: true, maxlength: 120 }],
    budgetPreference: { type: RangeSchema, default: null },
    durationPreference: { type: DurationRangeSchema, default: null },
    pace: {
      type: String,
      enum: ['relaxed', 'balanced', 'active', null],
      default: null,
    },
    accommodationPreferences: [{ type: String, trim: true, maxlength: 80 }],
    dislikedAccommodationPreferences: [{ type: String, trim: true, maxlength: 80 }],
    interests: [{ type: String, trim: true, maxlength: 80 }],
    dislikedInterests: [{ type: String, trim: true, maxlength: 80 }],
    // Reserved for explicit, non-sensitive structured notes. Chat text is never copied here.
    notes: [{ type: String, trim: true, maxlength: 200 }],
  },
  { timestamps: true, collection: 'userPreferences' }
)

export default mongoose.model('UserPreference', UserPreferenceSchema)
