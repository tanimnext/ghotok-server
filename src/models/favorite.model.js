import mongoose from 'mongoose';

const { Schema } = mongoose;

/** A biodata a user has added to their favorites ("shortlist"). */
const favoriteSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    biodata: { type: Schema.Types.ObjectId, ref: 'Biodata', required: true },
  },
  { timestamps: true },
);

favoriteSchema.index({ user: 1, biodata: 1 }, { unique: true });
favoriteSchema.index({ biodata: 1, createdAt: -1 });

export const Favorite = mongoose.model('Favorite', favoriteSchema);
