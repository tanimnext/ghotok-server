import mongoose from 'mongoose';

const { Schema } = mongoose;

export const CONTACT_MESSAGE_STATUS = ['new', 'read', 'replied', 'archived'];

/** A message sent through the public contact form (no account needed). */
const contactMessageSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    email: { type: String, maxlength: 120 },
    phone: { type: String, maxlength: 20 },
    subject: { type: String, maxlength: 160 },
    message: { type: String, required: true, maxlength: 3000 },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: CONTACT_MESSAGE_STATUS, default: 'new', index: true },
    ip: String,
  },
  { timestamps: true },
);

export const ContactMessage = mongoose.model('ContactMessage', contactMessageSchema);
