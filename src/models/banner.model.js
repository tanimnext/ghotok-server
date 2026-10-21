import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * A printable wedding banner design (a PDF with a preview image) that visitors
 * can download for free. Files are stored privately and served through
 * short-lived links; `downloads` counts each download.
 */
const bannerSchema = new Schema(
  {
    title: {
      en: { type: String, required: true, maxlength: 120 },
      bn: { type: String, maxlength: 120 },
    },
    previewKey: { type: String, required: true },
    fileKey: { type: String, required: true },
    fileName: { type: String, maxlength: 120 },
    downloads: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const Banner = mongoose.model('Banner', bannerSchema);
