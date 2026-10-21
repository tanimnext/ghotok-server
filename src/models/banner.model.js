import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * A printable wedding banner design that visitors can download for free. Both
 * images are hosted on ImgBB: a preview for the gallery and the full-size design
 * for download. `downloads` counts each download.
 */
const bannerSchema = new Schema(
  {
    title: {
      en: { type: String, required: true, maxlength: 120 },
      bn: { type: String, maxlength: 120 },
    },
    imageUrl: { type: String, required: true, maxlength: 500 },
    downloadUrl: { type: String, required: true, maxlength: 500 },
    downloads: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const Banner = mongoose.model('Banner', bannerSchema);
