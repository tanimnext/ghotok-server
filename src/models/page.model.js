import mongoose from 'mongoose';

const { Schema } = mongoose;

const i18nText = { en: { type: String, default: '' }, bn: { type: String, default: '' } };

/** An editable content page (about, guide, policies). The body is simple Markdown. */
const pageSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: i18nText,
    body: i18nText,
    isPublished: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const Page = mongoose.model('Page', pageSchema);
