import { PGlite } from '@electric-sql/pglite';
import { attachDatabasePool } from '@vercel/functions';
import { Pool } from 'pg';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from './config';
export interface Sql {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
}
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEMO_USERS = {
  operator: '60000000-0000-4000-8000-000000000001',
  supervisor: '60000000-0000-4000-8000-000000000002',
  admin: '60000000-0000-4000-8000-000000000003',
  other: '60000000-0000-4000-8000-000000000004',
};
export const CONDO = '10000000-0000-4000-8000-000000000001';
export const GATE = '20000000-0000-4000-8000-000000000001';
export class Database {
  private pool?: Pool;
  private embedded?: PGlite;
  async init(config: Config, memory = false) {
    if (config.APP_MODE === 'demo') {
      const dir = memory ? undefined : config.DEMO_DATA_DIR || resolve(ROOT, '.data/postgres');
      if (dir) await mkdir(dir, { recursive: true });
      this.embedded = new PGlite(dir);
      await this.embedded.waitReady;
      await this.embedded.exec(`create schema if not exists private;
        create table if not exists private.demo_migrations(name text primary key, applied_at timestamptz not null default now());`);
      const exists = await this.embedded.query("select to_regclass('public.packages') as name");
      const hasFoundation = Boolean((exists.rows[0] as { name: string | null }).name);
      const migrationFiles = (await readdir(resolve(ROOT, 'supabase/migrations')))
        .filter((file) => file.endsWith('.sql'))
        .sort();
      const applied = await this.embedded.query<{ name: string }>(
        'select name from private.demo_migrations',
      );
      const appliedNames = new Set(applied.rows.map((row) => row.name));
      if (hasFoundation && appliedNames.size === 0) {
        const foundation = migrationFiles.find((file) => file.includes('_foundation.sql'));
        if (foundation) {
          await this.embedded.query('insert into private.demo_migrations(name) values($1)', [
            foundation,
          ]);
          appliedNames.add(foundation);
        }
      }
      if (!hasFoundation) {
        await this.embedded.exec(`create role anon; create role authenticated; create schema auth;
          create table auth.users(id uuid primary key);
          create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
          create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
      }
      for (const file of migrationFiles) {
        if (appliedNames.has(file)) continue;
        await this.embedded.exec(
          await readFile(resolve(ROOT, 'supabase/migrations', file), 'utf8'),
        );
        await this.embedded.query('insert into private.demo_migrations(name) values($1)', [file]);
      }
      if (!hasFoundation) {
        await this.embedded.exec(await readFile(resolve(ROOT, 'supabase/seed.sql'), 'utf8'));
        await this.embedded.transaction(async (tx) => {
          for (const [kind, id] of Object.entries(DEMO_USERS)) {
            const condo = kind === 'other' ? '10000000-0000-4000-8000-000000000002' : CONDO;
            await tx.query('insert into auth.users(id) values($1)', [id]);
            await tx.query('insert into public.profiles(id,display_name) values($1,$2)', [
              id,
              {
                operator: 'Carlos Oliveira',
                supervisor: 'Ana Supervisora',
                admin: 'Administração',
                other: 'Operador de Teste',
              }[kind],
            ]);
            await tx.query(
              'insert into public.memberships(condominium_id,user_id,role) values($1,$2,$3)',
              [
                condo,
                id,
                kind === 'admin'
                  ? 'CONDO_ADMIN'
                  : kind === 'supervisor'
                    ? 'GATEHOUSE_SUPERVISOR'
                    : 'GATEHOUSE_OPERATOR',
              ],
            );
            const gates =
              kind === 'supervisor'
                ? [GATE, '20000000-0000-4000-8000-000000000002']
                : [kind === 'other' ? '20000000-0000-4000-8000-000000000003' : GATE];
            for (const gate of gates)
              await tx.query('insert into public.user_gatehouses values($1,$2,$3)', [
                condo,
                id,
                gate,
              ]);
          }
        });
      }
    } else {
      const ca = config.DATABASE_SSL_CA
        ? config.DATABASE_SSL_CA.replace(/\\n/g, '\n')
        : config.DATABASE_SSL_CA_PATH
          ? await readFile(resolve(ROOT, config.DATABASE_SSL_CA_PATH), 'utf8')
          : undefined;
      const ssl =
        config.DATABASE_SSL === 'true'
          ? {
              rejectUnauthorized: true,
              ...(ca ? { ca } : {}),
            }
          : false;
      this.pool = new Pool({
        connectionString: config.DATABASE_URL,
        max: config.DATABASE_POOL_MAX,
        ssl,
      });
      if (process.env.VERCEL) attachDatabasePool(this.pool);
    }
  }
  async transaction<T>(
    userId: string | null,
    fn: (sql: Sql) => Promise<T>,
    worker = false,
  ): Promise<T> {
    const run = async (sql: Sql) => {
      await sql.query(worker ? 'set local role sc_worker' : 'set local role sc_api');
      await sql.query("select set_config('request.jwt.claim.sub',$1,true)", [userId || '']);
      await sql.query("set local statement_timeout='10s'");
      return fn(sql);
    };
    if (this.embedded)
      return this.embedded.transaction((tx) =>
        run({
          query: async <T extends Record<string, unknown>>(s: string, p?: unknown[]) =>
            (await tx.query<T>(s, p)).rows,
        }),
      );
    if (!this.pool) throw new Error('Database not initialized');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await run({
        query: async <T extends Record<string, unknown>>(s: string, p?: unknown[]) =>
          (await client.query<T>(s, p)).rows,
      });
      await client.query('commit');
      return result;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool?.end();
    await this.embedded?.close();
  }
}
