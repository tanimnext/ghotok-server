import mongoose from 'mongoose';

const { Schema } = mongoose;

const RETENTION_DAYS = 180;

/**
 * An in-app notification. Only the `type` and its `data` are stored; the
 * clients render the text in the reader's language (see the web dictionaries).
 */
const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    data: { type: Schema.Types.Mixed, default: {} },
    link: String,
    readAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * RETENTION_DAYS });

export const Notification = mongoose.model('Notification', notificationSchema);
