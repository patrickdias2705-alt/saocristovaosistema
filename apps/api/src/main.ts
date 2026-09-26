import { readConfig } from './config';
import { Database } from './db';
import { createApplication } from './app';
import { seedDemoPackages } from './demo-seed';
async function main() {
  const config = readConfig();
  const db = new Database();
  await db.init(config);
  const { app, worker, ocr, packages } = await createApplication(config, db);
  if (config.APP_MODE === 'demo') await seedDemoPackages(packages);
  await app.listen(config.PORT, config.APP_MODE === 'demo' ? '127.0.0.1' : '0.0.0.0');
  console.log(
    JSON.stringify({ level: 'info', event: 'api_ready', port: config.PORT, mode: config.APP_MODE }),
  );
  const job = process.env.VERCEL
    ? undefined
    : setInterval(() => {
        void worker
          .tick()
          .catch(() =>
            console.error(JSON.stringify({ level: 'error', event: 'notification_worker_failed' })),
          );
      }, 3000);
  const retention = process.env.VERCEL
    ? undefined
    : setInterval(() => {
        void ocr
          .purgeExpiredImages()
          .catch(() =>
            console.error(JSON.stringify({ level: 'error', event: 'retention_failed' })),
          );
      }, 3600000);
  const stop = async () => {
    if (job) clearInterval(job);
    if (retention) clearInterval(retention);
    await app.close();
    await db.close();
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
void main().catch(() => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'startup_failed',
      hint: 'Check environment and database configuration.',
    }),
  );
  process.exitCode = 1;
});
