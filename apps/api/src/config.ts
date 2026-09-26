import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env'), quiet: true });
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_MODE: z.enum(['supabase', 'demo']).default('supabase'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: z.enum(['true', 'false']).default('true'),
  DATABASE_SSL_CA_PATH: z.string().optional(),
  DATABASE_SSL_CA: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(process.env.VERCEL ? 2 : 10),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  PIN_PEPPER: z.string().min(32),
  OUTBOX_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  OCR_SERVICE_URL: z.url().default('http://127.0.0.1:8000'),
  OCR_SERVICE_TOKEN: z.string().min(32),
  OCR_IMAGE_RETENTION_DAYS: z.coerce.number().int().min(0).max(30).default(0),
  WHATSAPP_PROVIDER: z.enum(['fake', 'meta']).default('fake'),
  META_WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  META_WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .optional(),
  META_TEMPLATE_NAME: z.string().default('encomenda_recebida'),
  WEB_ORIGIN: z.url().default('http://127.0.0.1:3000'),
  DEMO_DATA_DIR: z.string().optional(),
});
export type Config = z.infer<typeof envSchema>;
export function readConfig(): Config {
  const e = envSchema.parse(
    Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v])),
  );
  if (e.APP_MODE === 'demo' && e.NODE_ENV === 'production')
    throw new Error('Demo is disabled in production');
  if (e.APP_MODE === 'supabase' && (!e.DATABASE_URL || !e.SUPABASE_URL || !e.SUPABASE_ANON_KEY))
    throw new Error('Supabase configuration is required');
  if (
    e.WHATSAPP_PROVIDER === 'meta' &&
    (!e.META_GRAPH_VERSION ||
      !e.META_WHATSAPP_ACCESS_TOKEN ||
      !e.META_WHATSAPP_PHONE_NUMBER_ID ||
      !e.META_APP_SECRET ||
      !e.META_WHATSAPP_VERIFY_TOKEN)
  )
    throw new Error('Meta configuration is required');
  if (e.APP_MODE === 'demo' && e.WHATSAPP_PROVIDER !== 'fake')
    throw new Error('Demo only permits fake notifications');
  return e;
}
