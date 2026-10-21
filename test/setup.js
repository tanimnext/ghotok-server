import mongoose from 'mongoose';
import { afterAll, beforeAll, inject } from 'vitest';

// Each test file gets its own database on the shared in-memory server.
beforeAll(async () => {
  const dbName = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await mongoose.connect(inject('mongoUri'), { dbName });
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
