import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod;

export async function setup({ provide }) {
  mongod = await MongoMemoryServer.create();
  provide('mongoUri', mongod.getUri());
}

export async function teardown() {
  await mongod?.stop();
}
