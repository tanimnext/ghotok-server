import mongoose from 'mongoose';

const { Schema } = mongoose;

/** A record of a staff (or security-relevant) action, shown in Admin → Audit log. */
const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    actorRole: String,
    action: { type: String, required: true, index: true }, // e.g. "payment.verify"
    targetType: String,
    targetId: String,
    summary: String,
    meta: Schema.Types.Mixed,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
