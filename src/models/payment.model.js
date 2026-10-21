import mongoose from 'mongoose';
import { PAYMENT_METHODS, PAYMENT_STATUS, optionValues } from '@ghotok/shared';

const { Schema } = mongoose;

/**
 * A purchase of a connection package.
 *
 * - mode "manual": the customer sends money and submits a transaction ID; staff verify it.
 *   Status: pending → verified | rejected (→ refunded)
 * - mode "gateway": online checkout through bKash or Nagad.
 *   Status: initiated → verified | failed | cancelled (→ refunded)
 *
 * `creditedAt` is set exactly once, when the connections are added to the balance.
 */
const paymentSchema = new Schema(
  {
    invoiceNo: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    package: { type: Schema.Types.ObjectId, ref: 'Package' },
    packageName: { en: String, bn: String }, // snapshot, so history survives package edits
    connections: { type: Number, required: true, min: 1 },
    amount: { type: Number, required: true, min: 1 }, // BDT
    method: { type: String, enum: optionValues(PAYMENT_METHODS), required: true },
    mode: { type: String, enum: ['manual', 'gateway'], required: true },
    senderNumber: String,
    trxId: { type: String, trim: true },
    status: { type: String, enum: optionValues(PAYMENT_STATUS), default: 'pending', index: true },
    gateway: {
      paymentId: { type: String, index: true },
      response: Schema.Types.Mixed,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    rejectReason: { type: String, maxlength: 500 },
    creditedAt: Date,
    refundedAt: Date,
  },
  { timestamps: true },
);

paymentSchema.index({ method: 1, trxId: 1 });
paymentSchema.index({ createdAt: -1 });

export const Payment = mongoose.model('Payment', paymentSchema);
