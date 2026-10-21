import mongoose from 'mongoose';

const { Schema } = mongoose;

/** A group of site settings (e.g. "site", "payments"). Defaults live in settings.service.js. */
const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: Schema.Types.Mixed,
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const Setting = mongoose.model('Setting', settingSchema);
