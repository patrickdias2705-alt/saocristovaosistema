import { ForbiddenException } from '@nestjs/common';
import { residentSchema, unitSchema, memberSchema } from '@sc/validation';
import { Database, type Sql } from './db';
import type { Scope } from './packages';
import { recordAudit } from './events';
export class AdminService {
  constructor(private db: Database) {}
  async members(scope: Scope) {
    return this.db.transaction(scope.userId, async (sql) => {
      await this.requireAdmin(sql, scope.condominiumId);
      return {
        members: await sql.query(
          'select p.id,p.display_name,m.role from memberships m join profiles p on p.id=m.user_id where m.condominium_id=$1 and m.active',
          [scope.condominiumId],
        ),
        gatehouses: await sql.query('select id,name from gatehouses where condominium_id=$1', [
          scope.condominiumId,
        ]),
      };
    });
  }
  async requireAdmin(sql: Sql, c: string) {
    const [r] = await sql.query<{ allowed: boolean }>('select private.is_admin($1) as allowed', [
      c,
    ]);
    if (!r?.allowed) throw new ForbiddenException('Esta ação exige administração do condomínio.');
  }
  async catalog(scope: Scope) {
    return this.db.transaction(scope.userId, async (sql) => ({
      units: await sql.query(
        'select u.id,u.number,u.block_id,b.name as block from public.units u join public.blocks b on b.id=u.block_id where u.condominium_id=$1 order by b.name,u.number',
        [scope.condominiumId],
      ),
      blocks: await sql.query(
        'select id,name from public.blocks where condominium_id=$1 order by name',
        [scope.condominiumId],
      ),
    }));
  }
  async dashboard(scope: Scope) {
    return this.db.transaction(scope.userId, async (sql) => {
      await this.requireAdmin(sql, scope.condominiumId);
      const metrics = await sql.query(
        `select count(*) filter(where (received_at at time zone 'America/Sao_Paulo')::date=(now() at time zone 'America/Sao_Paulo')::date)::int as received,
      count(*) filter(where status='WAITING_PICKUP')::int as waiting,
      count(*) filter(where (picked_up_at at time zone 'America/Sao_Paulo')::date=(now() at time zone 'America/Sao_Paulo')::date)::int as picked,
      count(*) filter(where status in ('WAITING_PICKUP','INCIDENT') and received_at<now()-interval '7 days')::int as old from public.packages where condominium_id=$1`,
        [scope.condominiumId],
      );
      return {
        metrics: metrics[0],
        gatehouses: await sql.query(
          `select g.name,count(p.id)::int as count from public.gatehouses g left join public.packages p on p.gatehouse_id=g.id and p.status='WAITING_PICKUP' where g.condominium_id=$1 group by g.id order by g.name`,
          [scope.condominiumId],
        ),
        activity: await sql.query(
          'select action,created_at,entity_id from public.audit_logs where condominium_id=$1 order by created_at desc limit 20',
          [scope.condominiumId],
        ),
      };
    });
  }
  async residents(scope: Scope) {
    return this.db.transaction(scope.userId, async (sql) => {
      await this.requireAdmin(sql, scope.condominiumId);
      return sql.query(
        'select id,unit_id,full_name,phone,whatsapp_opt_in,active from public.residents where condominium_id=$1 order by full_name',
        [scope.condominiumId],
      );
    });
  }
  async createResident(scope: Scope, input: unknown) {
    const v = residentSchema.parse(input);
    return this.db.transaction(scope.userId, async (sql) => {
      await this.requireAdmin(sql, scope.condominiumId);
      const [row] = await sql.query<{ id: string }>(
        'insert into public.residents(condominium_id,unit_id,full_name,phone,whatsapp_opt_in) values($1,$2,$3,$4,$5) returning id',
        [scope.condominiumId, v.unitId, v.fullName, v.phone, v.whatsappOptIn],
      );
      await recordAudit(sql, scope.condominiumId, null, scope.userId, 'RESIDENT_CREATED', row!.id);
      return row;
    });
  }
  async createUnit(scope: Scope, input: unknown) {
    const v = unitSchema.parse(input);
    return this.db.transaction(scope.userId, async (sql) => {
      await this.requireAdmin(sql, scope.condominiumId);
      const [row] = await sql.query<{ id: string }>(
        'insert into public.units(condominium_id,block_id,number) values($1,$2,$3) returning id',
        [scope.condominiumId, v.blockId, v.number],
      );
      await recordAudit(sql, scope.condominiumId, null, scope.userId, 'UNIT_CREATED', row!.id);
      return row;
    });
  }
  async assignMember(scope: Scope, input: unknown) {
    const v = memberSchema.parse(input);
    return this.db.transaction(scope.userId, async (sql) => {
      await this.requireAdmin(sql, scope.condominiumId);
      if (v.userId === scope.userId)
        throw new ForbiddenException('Peça a outro administrador para alterar seu próprio acesso.');
      await sql.query(
        'insert into public.memberships(condominium_id,user_id,role) values($1,$2,$3) on conflict(condominium_id,user_id) do update set role=$3,active=true',
        [scope.condominiumId, v.userId, v.role],
      );
      await sql.query('delete from public.user_gatehouses where condominium_id=$1 and user_id=$2', [
        scope.condominiumId,
        v.userId,
      ]);
      for (const gate of new Set(v.gatehouseIds))
        await sql.query('insert into public.user_gatehouses values($1,$2,$3)', [
          scope.condominiumId,
          v.userId,
          gate,
        ]);
      await recordAudit(
        sql,
        scope.condominiumId,
        null,
        scope.userId,
        'MEMBERSHIP_UPDATED',
        v.userId,
        { role: v.role, gatehouseIds: v.gatehouseIds },
      );
      return { ok: true };
    });
  }
}
