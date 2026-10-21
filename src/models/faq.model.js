import mongoose from 'mongoose';

const { Schema } = mongoose;

const i18nText = { en: { type: String, default: '' }, bn: { type: String, default: '' } };

/** A frequently asked question shown on the FAQ page. */
const faqSchema = new Schema(
  {
    question: i18nText,
    answer: i18nText,
    category: { type: String, default: 'general' },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Faq = mongoose.model('Faq', faqSchema);
