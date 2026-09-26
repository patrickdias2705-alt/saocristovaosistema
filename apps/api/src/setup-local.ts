import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { readConfig } from './config';
import { CONDO, GATE, Database } from './db';
import { PackageService } from './packages';
import { seedDemoPackages } from './demo-seed';

async function main() {
  const c = readConfig();
  const supabaseUrl = new URL(c.SUPABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(supabaseUrl.hostname) || c.WHATSAPP_PROVIDER !== 'fake')
    throw new Error('Seed allowed only on local Supabase with fake WhatsApp');
  const migrationUrl = new URL(process.env.MIGRATION_DATABASE_URL || '');
  if (!['127.0.0.1', 'localhost'].includes(migrationUrl.hostname))
    throw new Error('Migration connection must be local');
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12 || !c.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Configure SEED_PASSWORD (12+ chars) and service role key');
  const pool = new Pool({ connectionString: migrationUrl.href });
  const auth = createClient(c.SUPABASE_URL!, c.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  try {
    const runtime = new URL(c.DATABASE_URL!);
    const username = decodeURIComponent(runtime.username);
    const dbPassword = decodeURIComponent(runtime.password);
    if (
      !/^[a-z][a-z0-9_]{2,30}$/.test(username) ||
      username === 'postgres' ||
      dbPassword.length < 16
    )
      throw new Error('Use a dedicated runtime login and 16+ character database password');
    const exists = await pool.query('select 1 from pg_roles where rolname=$1', [username]);
    if (!exists.rowCount)
      await pool.query(
        `create role "${username}" login noinherit nobypassrls password '${dbPassword.replaceAll("'", "''")}'`,
      );
    await pool.query(`grant sc_api,sc_worker to "${username}"`);
    const { data, error } = await auth.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;
    let adminId = '';
    for (const [email, name, role] of [
      ['operador@demo.local', 'Carlos Oliveira', 'GATEHOUSE_OPERATOR'],
      ['supervisor@demo.local', 'Ana Supervisora', 'GATEHOUSE_SUPERVISOR'],
      ['admin@demo.local', 'Administração', 'CONDO_ADMIN'],
    ]) {
      let user = data.users.find((u) => u.email === email);
      if (!user) {
        const created = await auth.auth.admin.createUser({ email, password, email_confirm: true });
        if (created.error) throw created.error;
        user = created.data.user;
      }
      await pool.query(
        'insert into profiles(id,display_name) values($1,$2) on conflict(id) do nothing',
        [user.id, name],
      );
      await pool.query(
        'insert into memberships(condominium_id,user_id,role) values($1,$2,$3) on conflict do nothing',
        [CONDO, user.id, role],
      );
      for (const gate of role === 'GATEHOUSE_SUPERVISOR'
        ? [GATE, '20000000-0000-4000-8000-000000000002']
        : [GATE])
        await pool.query('insert into user_gatehouses values($1,$2,$3) on conflict do nothing', [
          CONDO,
          user.id,
          gate,
        ]);
      if (role === 'CONDO_ADMIN') adminId = user.id;
    }
    const db = new Database();
    await db.init(c);
    try {
      await seedDemoPackages(new PackageService(db, c), adminId);
    } finally {
      await db.close();
    }
    console.log(
      'Seed Auth/profiles/packages concluído. Contas: operador@demo.local, supervisor@demo.local, admin@demo.local.',
    );
  } finally {
    await pool.end();
  }
}
void main().catch(() => {
  console.error(
    'Seed não concluído. Confira ambiente local, migrations, senha e credenciais. Nenhum segredo foi registrado.',
  );
  process.exitCode = 1;
});
