import mongoose from 'mongoose';
import { PROPOSAL_STATUS, optionValues } from '@ghotok/shared';

const { Schema } = mongoose;

/** An expression of interest from one member to the owner of a biodata. */
const proposalSchema = new Schema(
  {
    from: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    fromBiodata: { type: Schema.Types.ObjectId, ref: 'Biodata' },
    to: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    toBiodata: { type: Schema.Types.ObjectId, ref: 'Biodata', required: true },
    message: { type: String, maxlength: 1000 },
    status: { type: String, enum: optionValues(PROPOSAL_STATUS), default: 'pending', index: true },
    respondedAt: Date,
    responseNote: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);

proposalSchema.index({ from: 1, createdAt: -1 });
proposalSchema.index({ to: 1, createdAt: -1 });
proposalSchema.index({ from: 1, toBiodata: 1, status: 1 });

export const Proposal = mongoose.model('Proposal', proposalSchema);
