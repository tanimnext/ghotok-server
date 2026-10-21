import mongoose from 'mongoose';
import { REFUND_RESOLUTIONS, REFUND_STATUS, optionValues } from '@ghotok/shared';

const { Schema } = mongoose;

/** A customer's request to refund a payment, decided by a super admin. */
const refundRequestSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    reason: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: optionValues(REFUND_STATUS), default: 'pending', index: true },
    resolution: { type: String, enum: optionValues(REFUND_RESOLUTIONS) },
    connections: Number, // credited (connection_credit) or revoked (money_back)
    amount: Number, // BDT returned (money_back)
    refundTrxId: String,
    note: { type: String, maxlength: 1000 },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
  },
  { timestamps: true },
);

export const RefundRequest = mongoose.model('RefundRequest', refundRequestSchema);
