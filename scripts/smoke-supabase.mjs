import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const apiRequire = createRequire(resolve(root, 'apps/api/package.json'));
const { parse } = apiRequire('dotenv');
const { createClient } = apiRequire('@supabase/supabase-js');
const env = parse(await readFile(resolve(root, '.env')));

const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await client.auth.signInWithPassword({
  email: env.BOOTSTRAP_ADMIN_EMAIL,
  password: env.BOOTSTRAP_ADMIN_PASSWORD,
});
if (error || !data.session) throw error ?? new Error('Sessão ausente');

const authHeaders = { Authorization: `Bearer ${data.session.access_token}` };
const [web, health, config, me, ocr] = await Promise.all([
  fetch('http://127.0.0.1:3000/'),
  fetch('http://127.0.0.1:3001/health'),
  fetch('http://127.0.0.1:3001/config').then(async (response) => ({
    response,
    body: await response.json(),
  })),
  fetch('http://127.0.0.1:3001/me', { headers: authHeaders }).then(async (response) => ({
    response,
    body: await response.json(),
  })),
  fetch('http://127.0.0.1:8000/health'),
]);
const condominiumId = me.body.memberships?.[0]?.condominium_id;
const catalog = await fetch('http://127.0.0.1:3001/catalog', {
  headers: { ...authHeaders, 'X-Condominium-Id': condominiumId },
}).then(async (response) => ({ response, body: await response.json() }));

const result = {
  auth: true,
  web: web.status,
  apiHealth: health.status,
  hostedMode:
    config.response.ok &&
    config.body.demo === false &&
    config.body.supabaseUrl === env.SUPABASE_URL,
  me: me.response.status,
  catalog: catalog.response.status,
  catalogBlocks: Array.isArray(catalog.body.blocks) ? catalog.body.blocks.length : null,
  catalogUnits: Array.isArray(catalog.body.units) ? catalog.body.units.length : null,
  ocrHealth: ocr.status,
};
console.log(JSON.stringify(result));

const checks = [web.ok, health.ok, result.hostedMode, me.response.ok, catalog.response.ok, ocr.ok];
if (checks.some((value) => !value)) process.exitCode = 1;
await client.auth.signOut();
