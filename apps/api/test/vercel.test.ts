import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Config } from '../src/config';
import { Database } from '../src/db';
import { createApplication } from '../src/app';

test('Vercel service exposes the API under the shared /api prefix', async () => {
  const previous = process.env.VERCEL;
  process.env.VERCEL = '1';
  const config: Config = {
    NODE_ENV: 'test',
    APP_MODE: 'demo',
    PORT: 3001,
    DATABASE_SSL: 'false',
    DATABASE_POOL_MAX: 2,
    PIN_PEPPER: randomBytes(32).toString('hex'),
    OUTBOX_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    OCR_SERVICE_TOKEN: randomBytes(32).toString('hex'),
    OCR_SERVICE_URL: 'http://127.0.0.1:8000',
    OCR_IMAGE_RETENTION_DAYS: 0,
    WHATSAPP_PROVIDER: 'fake',
    META_TEMPLATE_NAME: 'encomenda_recebida',
    WEB_ORIGIN: 'http://127.0.0.1:3000',
  };
  const db = new Database();
  await db.init(config, true);
  const application = await createApplication(config, db);
  try {
    await application.app.listen(0, '127.0.0.1');
    const address = await application.app.getUrl();
    const response = await fetch(`${address}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  } finally {
    await application.app.close();
    await db.close();
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
});
