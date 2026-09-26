import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const apiRequire = createRequire(resolve(root, 'apps/api/package.json'));
const webRequire = createRequire(resolve(root, 'apps/web/package.json'));
const { parse } = apiRequire('dotenv');
const fileEnv = parse(await readFile(resolve(root, '.env')));
const env = {
  ...process.env,
  ...fileEnv,
  NODE_ENV: 'development',
  APP_MODE: 'supabase',
  WHATSAPP_PROVIDER: 'fake',
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
  console.log('OCR indisponível: instale apps/ocr/requirements.txt na .venv.');
}

start(process.execPath, [apiRequire.resolve('tsx/cli'), 'src/main.ts'], resolve(root, 'apps/api'));
start(
  process.execPath,
  [webRequire.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3000'],
  resolve(root, 'apps/web'),
);

console.log('Supabase hospedado: http://127.0.0.1:3000 • WhatsApp simulado.');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of children) child.kill('SIGTERM');
  });
}
