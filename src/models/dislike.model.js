import mongoose from 'mongoose';

const { Schema } = mongoose;

/** A biodata a user marked "not interested". Disliked biodatas are hidden from that user's search. */
const dislikeSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    biodata: { type: Schema.Types.ObjectId, ref: 'Biodata', required: true },
  },
  { timestamps: true },
);

dislikeSchema.index({ user: 1, biodata: 1 }, { unique: true });
dislikeSchema.index({ biodata: 1, createdAt: -1 });

export const Dislike = mongoose.model('Dislike', dislikeSchema);
