import mongoose from 'mongoose';

const { Schema } = mongoose;

export const STORY_STATUS = ['pending', 'published', 'hidden'];

/**
 * "We got married": filled in by a member when they delete their biodata because
 * they married. It feeds the success count, and with the member's consent and staff
 * approval its story is shown on the home page.
 */
const marriageReportSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    biodata: { type: Schema.Types.ObjectId, ref: 'Biodata', required: true },
    viaGhotok: { type: Boolean, default: false },
    marriedOn: Date,
    place: { type: String, maxlength: 120 },
    // The partner's biodata, when they were registered on Ghotok too.
    partnerBiodata: { type: Schema.Types.ObjectId, ref: 'Biodata' },
    partner: {
      name: { type: String, maxlength: 80 },
      district: String,
      profession: String,
      education: String,
    },
    story: { type: String, maxlength: 2000 },
    // The member agreed to their story being shown on the site (without names).
    shareStory: { type: Boolean, default: false },
    storyStatus: { type: String, enum: STORY_STATUS, default: 'pending', index: true },
    // Staff may tidy the text before publishing it.
    publishedStory: { type: String, maxlength: 2000 },
    publishedAt: Date,
  },
  { timestamps: true },
);

export const MarriageReport = mongoose.model('MarriageReport', marriageReportSchema);
