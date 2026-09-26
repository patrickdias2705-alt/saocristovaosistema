import 'reflect-metadata';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import sharp from 'sharp';
import { Database, CONDO, GATE, DEMO_USERS } from '../src/db';
import { PackageService } from '../src/packages';
import { AdminService } from '../src/admin';
import {
  FakeWhatsAppProvider,
  NotificationWorker,
  MetaWhatsAppProvider,
} from '../src/notifications';
import {
  newPin,
  hashPin,
  verifyPin,
  pinLookup,
  publicCode,
  transition,
  matchScore,
  encrypt,
  decrypt,
} from '../src/domain';
import type { Config } from '../src/config';
import { createApplication } from '../src/app';
const config: Config = {
  NODE_ENV: 'test',
  APP_MODE: 'demo',
  PORT: 3001,
  DATABASE_SSL: 'false',
  DATABASE_POOL_MAX: 10,
  PIN_PEPPER: randomBytes(32).toString('hex'),
  OUTBOX_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  OCR_SERVICE_TOKEN: randomBytes(32).toString('hex'),
  OCR_SERVICE_URL: 'http://127.0.0.1:8000',
  OCR_IMAGE_RETENTION_DAYS: 0,
  WHATSAPP_PROVIDER: 'fake',
  META_TEMPLATE_NAME: 'encomenda_recebida',
  WEB_ORIGIN: 'http://127.0.0.1:3000',
  META_APP_SECRET: randomBytes(32).toString('hex'),
};
const db = new Database();
const packages = new PackageService(db, config);
const operator = { userId: DEMO_USERS.operator, condominiumId: CONDO };
const supervisor = { userId: DEMO_USERS.supervisor, condominiumId: CONDO };
const admin = { userId: DEMO_USERS.admin, condominiumId: CONDO };
const gate2 = '20000000-0000-4000-8000-000000000002';
const input = () => ({
  gatehouseId: GATE,
  unitId: '40000000-0000-4000-8000-000000000001',
  residentId: '50000000-0000-4000-8000-000000000001',
  recipientNameRaw: 'Maria Aparecida Silva',
  recipientConfirmed: true as const,
  idempotencyKey: randomUUID(),
});
let app: Awaited<ReturnType<typeof createApplication>>;
let address: string;
let token: string;
let ocrServer: Server;
before(async () => {
  await db.init(config, true);
  ocrServer = createServer(async (req, res) => {
    if (req.headers['x-service-token'] !== config.OCR_SERVICE_TOKEN) {
      res.writeHead(401).end();
      return;
    }
    for await (const _part of req) {
      /* drain multipart */
    }
    const field = (value: string | null) => ({ value, confidence: value ? 0.9 : 0 });
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        recipientName: field('Maria Aparecida Silva'),
        block: field('18'),
        apartment: field('66'),
        trackingCode: field('AB123456789BR'),
        carrier: field('Correios'),
        address: field(null),
        rawText: 'Fixture de teste explícita',
        processingTime: 1,
        requestId: randomUUID(),
        provider: 'test-fixture',
      }),
    );
  });
  await new Promise<void>((r) => ocrServer.listen(0, '127.0.0.1', r));
  config.OCR_SERVICE_URL = `http://127.0.0.1:${(ocrServer.address() as { port: number }).port}`;
  app = await createApplication(config, db);
  await app.app.listen(0, '127.0.0.1');
  address = await app.app.getUrl();
  const res = await fetch(`${address}/auth/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'operator' }),
  });
  token = ((await res.json()) as { accessToken: string }).accessToken;
});
after(async () => {
  await app?.app.close();
  await db.close();
  ocrServer?.close();
});
async function http(path: string, body?: unknown, condo = CONDO) {
  return fetch(`${address}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Condominium-Id': condo,
      ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
}
test('PIN and public code: format, entropy source, salted verification and scoped HMAC', async () => {
  const pin = newPin();
  assert.match(pin, /^\d{6}$/);
  const a = await hashPin(pin);
  const b = await hashPin(pin);
  assert.notEqual(a, b);
  assert.equal(await verifyPin(pin, a), true);
  assert.equal(await verifyPin(pin === '000000' ? '000001' : '000000', a), false);
  assert.notEqual(
    pinLookup(pin, CONDO, GATE, config.PIN_PEPPER),
    pinLookup(pin, CONDO, gate2, config.PIN_PEPPER),
  );
  assert.match(publicCode(), /^SC-[0-9A-F]{12}$/);
  assert.equal(new Set(Array.from({ length: 1000 }, publicCode)).size, 1000);
});
test('authenticated encryption detects tampering', () => {
  const encoded = encrypt({ pin: '123456' }, config.OUTBOX_ENCRYPTION_KEY);
  assert(!encoded.includes('123456'));
  assert.deepEqual(decrypt(encoded, config.OUTBOX_ENCRYPTION_KEY), { pin: '123456' });
  assert.throws(() => decrypt(encoded, randomBytes(32).toString('hex')));
});
test('deterministic matching prioritizes exact unit, never auto-confirms', async () => {
  const rows = await packages.candidates(operator, {
    name: 'maria aparecida sílva',
    block: '18',
    apartment: '66',
  });
  assert.equal(rows[0]?.full_name, 'Maria Aparecida Silva');
  assert.equal(rows[0]?.score, 100);
  assert(
    matchScore(
      { full_name: 'Maria Aparecida Silva', block: '07', apartment: '42' },
      { name: 'Maria Aparecida Silva', block: '18', apartment: '66' },
    ) < 50,
  );
});
test('confirmation is mandatory at API boundary', async () => {
  assert.equal((await http('packages', { ...input(), recipientConfirmed: false })).status, 400);
});
test('unauthenticated HTTP requests are rejected', async () => {
  assert.equal((await fetch(`${address}/packages?gatehouseId=${GATE}`)).status, 401);
});
test('full HTTP slice: image -> suggestions -> explicit confirmation -> encrypted outbox -> PIN -> pickup -> history', async () => {
  const file = new FormData();
  file.append('gatehouseId', GATE);
  file.append(
    'file',
    new Blob(
      [
        new Uint8Array(
          await sharp({ create: { width: 40, height: 40, channels: 3, background: 'white' } })
            .png()
            .toBuffer(),
        ),
      ],
      { type: 'image/png' },
    ),
    'label.png',
  );
  const ocr = await http('ocr', file);
  assert.equal(ocr.status, 201);
  const suggestion = (await ocr.json()) as { id: string; candidates: { id: string }[] };
  assert.equal(suggestion.candidates[0]?.id, input().residentId);
  const created = await http('packages', { ...input(), ocrResultId: suggestion.id });
  assert.equal(created.status, 201);
  const p = (await created.json()) as { id: string; pin: string; publicCode: string };
  assert.match(p.pin, /^\d{6}$/);
  const worker = new NotificationWorker(db, config, new FakeWhatsAppProvider());
  await worker.tick();
  const found = await http('packages/find-pin', { gatehouseId: GATE, pin: p.pin });
  assert.equal(found.status, 201);
  assert.equal(((await found.json()) as { id: string }).id, p.id);
  const picked = await http(`packages/${p.id}/commands`, {
    command: 'pickup',
    recipientChecked: true,
  });
  assert.equal(picked.status, 201);
  assert.equal(
    (await http(`packages/${p.id}/commands`, { command: 'pickup', recipientChecked: true })).status,
    409,
  );
  const detail = await packages.detail(operator, p.id);
  assert.equal(detail.package.status, 'PICKED_UP');
  assert(detail.events.some((e) => e.type === 'NOTIFICATION_SENT'));
  assert(detail.events.some((e) => e.type === 'PICKUP_COMPLETED'));
  assert(detail.fakeMessage?.includes(p.pin));
  const row = await db.transaction(operator.userId, (sql) =>
    sql.query<{ pickup_pin_hash: string; encrypted_payload: string }>(
      'select p.pickup_pin_hash,n.encrypted_payload from packages p join notifications n on n.package_id=p.id where p.id=$1',
      [p.id],
    ),
  );
  assert(!row[0]!.pickup_pin_hash.includes(p.pin));
  assert(!row[0]!.encrypted_payload.includes(p.pin));
});
test('invalid MIME content rejected before reaching OCR', async () => {
  const form = new FormData();
  form.append('gatehouseId', GATE);
  form.append('file', new Blob(['not image'], { type: 'image/png' }), 'bad.png');
  assert.equal((await http('ocr', form)).status, 400);
});
test('idempotent reception does not duplicate packages or notification', async () => {
  const v = input();
  const first = await packages.receive(operator, v);
  const second = await packages.receive(operator, v);
  assert.equal(first.id, second.id);
  assert.equal(second.pin, null);
  assert.equal(second.replayed, true);
  await assert.rejects(() => packages.receive(operator, { ...v, carrier: 'changed' }));
});
test('resident/unit cross-reference rejected with atomic rollback', async () => {
  const before = await packages.search(operator, GATE, '');
  await assert.rejects(() =>
    packages.receive(operator, { ...input(), unitId: '40000000-0000-4000-8000-000000000002' }),
  );
  assert.equal((await packages.search(operator, GATE, '')).length, before.length);
});
test('operator cannot receive/search/pick up another gatehouse; supervisor can', async () => {
  const p = await packages.receive(supervisor, { ...input(), gatehouseId: gate2 });
  await assert.rejects(() => packages.search(operator, gate2, ''));
  await assert.rejects(() => packages.receive(operator, { ...input(), gatehouseId: gate2 }));
  await assert.rejects(() => packages.detail(operator, p.id));
  await assert.rejects(() =>
    packages.command(operator, p.id, { command: 'pickup', recipientChecked: true }),
  );
  assert.equal((await packages.detail(supervisor, p.id)).package.id, p.id);
});
test('RLS restricts unfiltered queries by gatehouse and tenant', async () => {
  const rows = await db.transaction(operator.userId, (sql) =>
    sql.query<{ condominium_id: string; gatehouse_id: string }>(
      'select condominium_id,gatehouse_id from packages',
    ),
  );
  assert(rows.length > 0);
  assert(rows.every((r) => r.condominium_id === CONDO && r.gatehouse_id === GATE));
  const other = await db.transaction(DEMO_USERS.other, (sql) =>
    sql.query('select * from packages'),
  );
  assert.equal(other.length, 0);
  assert.equal(
    (await http(`packages?gatehouseId=${GATE}`, undefined, '10000000-0000-4000-8000-000000000002'))
      .status,
    403,
  );
});
test('database rejects direct cross-tenant writes even without service validation', async () => {
  await assert.rejects(() =>
    db.transaction(operator.userId, (sql) =>
      sql.query('insert into residents(condominium_id,unit_id,full_name) values($1,$2,$3)', [
        '10000000-0000-4000-8000-000000000002',
        '40000000-0000-4000-8000-000000000004',
        'Forbidden',
      ]),
    ),
  );
});
test('administrative permissions enforced independently of UI', async () => {
  const service = new AdminService(db);
  await assert.rejects(() => service.dashboard(operator));
  assert((await service.dashboard(admin)).metrics);
  assert.equal((await http('admin/residents', {})).status, 400);
  assert.equal((await http('admin/dashboard')).status, 403);
});
test('cancel requires reason and history cannot be deleted or rewritten', async () => {
  const p = await packages.receive(operator, input());
  await assert.rejects(() => packages.command(operator, p.id, { command: 'cancel', reason: '' }));
  await packages.command(operator, p.id, {
    command: 'cancel',
    reason: 'Recebimento duplicado conferido.',
  });
  const detail = await packages.detail(operator, p.id);
  assert.equal(detail.package.status, 'CANCELED');
  assert(detail.events.some((e) => e.type === 'PACKAGE_CANCELED'));
  await assert.rejects(() =>
    db.transaction(operator.userId, (sql) =>
      sql.query('delete from package_events where package_id=$1', [p.id]),
    ),
  );
  await assert.rejects(() =>
    db.transaction(operator.userId, (sql) =>
      sql.query('update audit_logs set action=$1', ['TAMPERED']),
    ),
  );
});
test('incident must be resolved before pickup and terminal states do not reopen', () => {
  assert.equal(transition('WAITING_PICKUP', 'incident'), 'INCIDENT');
  assert.throws(() => transition('INCIDENT', 'pickup'));
  assert.equal(transition('INCIDENT', 'resolve'), 'WAITING_PICKUP');
  for (const status of ['PICKED_UP', 'CANCELED', 'RETURNED'] as const)
    assert.throws(() => transition(status, 'resolve'));
});
test('concurrent pickups yield one success and one event', async () => {
  const p = await packages.receive(operator, input());
  const outcomes = await Promise.allSettled([
    packages.command(operator, p.id, { command: 'pickup', recipientChecked: true }),
    packages.command(operator, p.id, { command: 'pickup', recipientChecked: true }),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (await packages.detail(operator, p.id)).events.filter((e) => e.type === 'PICKUP_COMPLETED')
      .length,
    1,
  );
});
test('notification failure preserves package and retries with encrypted payload', async () => {
  const p = await packages.receive(operator, input());
  const fail = new NotificationWorker(db, config, {
    send: async () => {
      throw new Error('Provider offline');
    },
  });
  await fail.tick();
  assert.equal((await packages.detail(operator, p.id)).package.status, 'WAITING_PICKUP');
  await db.transaction(
    null,
    (sql) => sql.query('update notifications set available_at=now() where package_id=$1', [p.id]),
    true,
  );
  await new NotificationWorker(db, config, new FakeWhatsAppProvider()).tick();
  assert.equal((await packages.detail(operator, p.id)).package.notification_status, 'SENT');
});
test('no opted-in contact queues a traceable skipped notification', async () => {
  const p = await packages.receive(operator, { ...input(), residentId: null });
  assert.equal(p.notificationStatus, 'SKIPPED');
  assert.equal((await packages.detail(operator, p.id)).fakeMessage, null);
});
test('webhook verifies signature and preserves monotonic delivery state', async () => {
  const p = await packages.receive(operator, input());
  await app.worker.tick();
  const [n] = await db.transaction(
    null,
    (sql) =>
      sql.query<{ provider_message_id: string }>(
        'select provider_message_id from notifications where package_id=$1',
        [p.id],
      ),
    true,
  );
  const body = JSON.stringify({
    entry: [
      { changes: [{ value: { statuses: [{ id: n!.provider_message_id, status: 'read' }] } }] },
    ],
  });
  assert.equal(
    (
      await fetch(`${address}/webhooks/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    ).status,
    403,
  );
  const signature = `sha256=${createHmac('sha256', config.META_APP_SECRET!).update(body).digest('hex')}`;
  assert.equal(
    (
      await fetch(`${address}/webhooks/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
        body,
      })
    ).status,
    200,
  );
  await app.worker.delivery(n!.provider_message_id, 'delivered');
  assert.equal((await packages.detail(operator, p.id)).package.notification_status, 'READ');
});
test('Meta refuses fictitious seed phone numbers before network', async () => {
  await assert.rejects(
    () =>
      new MetaWhatsAppProvider(config).send({
        to: '+5500000000001',
        name: 'Test',
        condominium: 'Test',
        block: '18',
        apartment: '66',
        gatehouse: '01',
        time: 'now',
        pin: '123456',
        publicCode: 'SC-ABCDEF012345',
      }),
    /FICTIONAL_CONTACT/,
  );
});
test('PIN brute force is bounded per operator in database', async () => {
  for (let n = 0; n < 13; n++)
    await packages.findPin(supervisor, GATE, '000000').catch(() => undefined);
  await assert.rejects(() => packages.findPin(supervisor, GATE, '000000'), /Muitas tentativas/);
});
