import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
await mkdir(resolve(root, '.data'), { recursive: true });
const envFile = resolve(root, '.data/demo-secrets.json');
let secrets;
try {
  secrets = JSON.parse(await readFile(envFile, 'utf8'));
} catch {
  secrets = {
    PIN_PEPPER: randomBytes(32).toString('hex'),
    OUTBOX_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    OCR_SERVICE_TOKEN: randomBytes(32).toString('hex'),
  };
  await writeFile(envFile, JSON.stringify(secrets), { mode: 0o600 });
}
const env = {
  ...process.env,
  ...secrets,
  NODE_ENV: 'development',
  APP_MODE: 'demo',
  WHATSAPP_PROVIDER: 'fake',
  OCR_IMAGE_RETENTION_DAYS: '0',
  PORT: process.env.PORT || '3001',
  WEB_ORIGIN: 'http://127.0.0.1:3000',
};
const children = [];
function start(command, args, cwd) {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('error', () =>
    console.error('Não foi possível iniciar um serviço. Consulte README.md.'),
  );
  return child;
}
const python = resolve(
  root,
  'apps/ocr/.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
try {
  await access(python);
  start(
    python,
    [
      '-m',
      'uvicorn',
      'main:app',
      '--host',
      '127.0.0.1',
      '--port',
      '8000',
      '--no-access-log',
      '--limit-concurrency',
      '4',
    ],
    resolve(root, 'apps/ocr'),
  );
} catch {
  console.log(
    'OCR: instale apps/ocr/requirements.txt na .venv. Cadastro manual continua disponível.',
  );
}
const apiRequire = createRequire(resolve(root, 'apps/api/package.json'));
const webRequire = createRequire(resolve(root, 'apps/web/package.json'));
start(process.execPath, [apiRequire.resolve('tsx/cli'), 'src/main.ts'], resolve(root, 'apps/api'));
start(
  process.execPath,
  [webRequire.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3000'],
  resolve(root, 'apps/web'),
);
console.log('Demonstração: http://127.0.0.1:3000 • Identidades e mensagens simuladas.');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    for (const child of children) child.kill('SIGTERM');
  });
