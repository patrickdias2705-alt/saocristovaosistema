import type { Sql } from './db';
export async function recordEvent(
  sql: Sql,
  scope: { condominium_id: string; gatehouse_id: string; id: string },
  type: string,
  actor: string | null,
  detail: Record<string, unknown> = {},
) {
  await sql.query(
    'insert into public.package_events(condominium_id,gatehouse_id,package_id,type,actor_id,detail) values($1,$2,$3,$4,$5,$6)',
    [scope.condominium_id, scope.gatehouse_id, scope.id, type, actor, JSON.stringify(detail)],
  );
  await recordAudit(sql, scope.condominium_id, scope.gatehouse_id, actor, type, scope.id, detail);
}
export async function recordAudit(
  sql: Sql,
  condo: string,
  gate: string | null,
  actor: string | null,
  action: string,
  id: string,
  detail: Record<string, unknown> = {},
) {
  await sql.query(
    'insert into public.audit_logs(condominium_id,gatehouse_id,actor_id,action,entity_id,detail) values($1,$2,$3,$4,$5,$6)',
    [condo, gate, actor, action, id, JSON.stringify(detail)],
  );
}
