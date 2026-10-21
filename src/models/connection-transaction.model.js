import mongoose from 'mongoose';
import { LEDGER_TYPES, optionValues } from '@ghotok/shared';

const { Schema } = mongoose;

/**
 * Append-only ledger of connection balance changes. `User.connectionBalance`
 * is the source of truth for spending; every change to it writes one row here.
 */
const connectionTransactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: optionValues(LEDGER_TYPES), required: true },
    delta: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
    biodata: { type: Schema.Types.ObjectId, ref: 'Biodata' },
    refund: { type: Schema.Types.ObjectId, ref: 'RefundRequest' },
    actor: { type: Schema.Types.ObjectId, ref: 'User' }, // staff member, for manual changes
    reason: { type: String, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

connectionTransactionSchema.index({ user: 1, createdAt: -1 });
connectionTransactionSchema.index({ type: 1, createdAt: -1 });

export const ConnectionTransaction = mongoose.model('ConnectionTransaction', connectionTransactionSchema);
