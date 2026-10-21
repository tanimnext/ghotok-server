import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema(
  { _id: String, seq: { type: Number, default: 0 } },
  { versionKey: false },
);

export const Counter = mongoose.model('Counter', counterSchema);

/** Atomically returns the next number of a named sequence, starting after `start`. */
export async function nextSequence(name, start = 0) {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return start + doc.seq;
}
