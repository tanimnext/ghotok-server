import mongoose from 'mongoose';
import { TICKET_CATEGORIES, TICKET_PRIORITY, TICKET_STATUS, optionValues } from '../shared/index.js';

const { Schema } = mongoose;

const attachmentSchema = new Schema(
  {
    // An image hosted on ImgBB (uploaded by the browser).
    url: { type: String, required: true, maxlength: 500 },
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    staff: { type: Boolean, default: false },
    // A message may be only images.
    body: { type: String, default: '', maxlength: 20000 },
    attachments: { type: [attachmentSchema], default: undefined },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/**
 * A support conversation between a member and staff.
 * Status: open → answered (staff replied) ⇄ waiting (member replied) → closed
 */
const supportTicketSchema = new Schema(
  {
    ticketNo: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subject: { type: String, required: true, maxlength: 160 },
    category: { type: String, enum: optionValues(TICKET_CATEGORIES), default: 'other' },
    status: { type: String, enum: optionValues(TICKET_STATUS), default: 'open', index: true },
    priority: { type: String, enum: optionValues(TICKET_PRIORITY), default: 'normal' },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    messages: [messageSchema],
    // A ticket opened by reporting a biodata.
    report: { type: Schema.Types.ObjectId, ref: 'Report' },
    biodata: { type: Schema.Types.ObjectId, ref: 'Biodata' },
    lastMessageAt: { type: Date, default: Date.now },
    lastStaffMessageAt: Date,
    // When the member last opened the ticket, to flag new replies.
    userReadAt: Date,
    closedAt: Date,
  },
  { timestamps: true },
);

supportTicketSchema.index({ lastMessageAt: -1 });

export const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);
