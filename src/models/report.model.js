import mongoose from 'mongoose';
import { REPORT_REASONS, REPORT_STATUS, optionValues } from '@ghotok/shared';

const { Schema } = mongoose;

/** A complaint about a biodata or its owner, handled by support staff. */
const reportSchema = new Schema(
  {
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    biodata: { type: Schema.Types.ObjectId, ref: 'Biodata' },
    targetUser: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, enum: optionValues(REPORT_REASONS), required: true },
    details: { type: String, maxlength: 2000 },
    status: { type: String, enum: optionValues(REPORT_STATUS), default: 'open', index: true },
    actionTaken: { type: String, maxlength: 500 },
    handledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    handledAt: Date,
    // The support conversation about this report.
    ticket: { type: Schema.Types.ObjectId, ref: 'SupportTicket' },
    // Whether the reporter got their connection back when the report was upheld.
    connectionRefunded: { type: Boolean, default: false },
  },
  { timestamps: true },
);

reportSchema.index({ createdAt: -1 });
reportSchema.index({ targetUser: 1 });

export const Report = mongoose.model('Report', reportSchema);
