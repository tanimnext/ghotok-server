import mongoose from 'mongoose';

const { Schema } = mongoose;

const i18nText = { en: { type: String, trim: true }, bn: { type: String, trim: true } };

/** A connection package customers can buy, e.g. 3 connections for ৳300. Managed by super admins. */
const packageSchema = new Schema(
  {
    name: { en: { type: String, required: true, trim: true }, bn: { type: String, trim: true } },
    description: i18nText,
    connections: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 1 }, // BDT
    isActive: { type: Boolean, default: true },
    highlight: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const Package = mongoose.model('Package', packageSchema);
