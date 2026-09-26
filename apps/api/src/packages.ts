import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  receiveSchema,
  commandSchema,
  matchSchema,
  type ReceiveInput,
  type PackageStatus,
} from '@sc/validation';
import { Database, type Sql } from './db';
import type { Config } from './config';
import {
  newPin,
  hashPin,
  pinLookup,
  publicCode,
  encrypt,
  verifyPin,
  transition,
  matchScore,
  decrypt,
} from './domain';
import { recordEvent } from './events';
import { notificationPayloadSchema } from './notifications';
export interface Scope {
  userId: string;
  condominiumId: string;
}
export const packageSelect = `select p.id,p.public_code,p.recipient_name_raw,p.status,p.received_at,p.picked_up_at,
  p.external_tracking_code,p.gatehouse_id,b.name as block,u.number as apartment,g.name as gatehouse,n.status as notification_status
  from public.packages p join public.units u on u.id=p.unit_id join public.blocks b on b.id=u.block_id
  join public.gatehouses g on g.id=p.gatehouse_id left join public.notifications n on n.package_id=p.id`;
type PackageRow = {
  id: string;
  condominium_id: string;
  gatehouse_id: string;
  status: PackageStatus;
  pickup_pin_hash: string;
  request_hash: string;
  public_code: string;
};
export class PackageService {
  constructor(
    readonly db: Database,
    readonly config: Config,
  ) {}
  async gate(sql: Sql, condo: string, gate: string) {
    const [row] = await sql.query<{ id: string; name: string }>(
      'select id,name from public.gatehouses where condominium_id=$1 and id=$2',
      [condo, gate],
    );
    if (!row) throw new ForbiddenException('Portaria não autorizada.');
    return row;
  }
  async limit(scope: Scope, kind: string, max: number) {
    const allowed = await this.db.transaction(scope.userId, async (sql) => {
      const key = `${scope.userId}:${kind}`;
      const [row] = await sql.query<{ hits: number }>(
        `insert into public.rate_limits(key,hits,expires_at) values($1,1,now()+interval '1 minute')
        on conflict(key) do update set hits=case when rate_limits.expires_at<now() then 1 else rate_limits.hits+1 end,
        expires_at=case when rate_limits.expires_at<now() then now()+interval '1 minute' else rate_limits.expires_at end returning hits`,
        [key],
      );
      return (row?.hits || 0) <= max;
    });
    if (!allowed) throw new HttpException('Muitas tentativas. Aguarde um minuto.', 429);
  }
  async candidates(scope: Scope, input: unknown) {
    const v = matchSchema.parse(input);
    return this.db.transaction(scope.userId, async (sql) => {
      // Rank exact unit signals in SQL first; fuzzy scoring stays deterministic and advisory.
      const rows = await sql.query<{
        id: string;
        unit_id: string;
        full_name: string;
        block: string;
        apartment: string;
      }>(
        `select r.id,r.unit_id,r.full_name,b.name as block,u.number as apartment
      from public.residents r join public.units u on u.id=r.unit_id join public.blocks b on b.id=u.block_id
      where r.condominium_id=$1 and r.active order by
      (ltrim(b.name,'0')=ltrim($2,'0') and ltrim(u.number,'0')=ltrim($3,'0')) desc,
      (r.full_name ilike '%' || $4 || '%') desc, r.full_name limit 500`,
        [scope.condominiumId, v.block, v.apartment, v.name.trim().split(' ')[0] || ''],
      );
      return rows
        .map((r) => ({ ...r, score: matchScore(r, v) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
    });
  }
  async receive(scope: Scope, input: unknown) {
    const v = receiveSchema.parse(input);
    const requestHash = createHash('sha256').update(JSON.stringify(v)).digest('hex');
    for (let attempt = 0; attempt < 4; attempt++) {
      const pin = newPin();
      const hash = await hashPin(pin);
      try {
        return await this.db.transaction(scope.userId, async (sql) => {
          const gate = await this.gate(sql, scope.condominiumId, v.gatehouseId);
          const [existing] = await sql.query<PackageRow>(
            'select * from public.packages where condominium_id=$1 and received_by_user_id=$2 and idempotency_key=$3',
            [scope.condominiumId, scope.userId, v.idempotencyKey],
          );
          if (existing) {
            if (existing.request_hash !== requestHash)
              throw new ConflictException('Esta requisição já foi usada com outros dados.');
            return { id: existing.id, publicCode: existing.public_code, pin: null, replayed: true };
          }
          const [unit] = await sql.query<{ block: string; apartment: string }>(
            `select b.name as block,u.number as apartment from public.units u join public.blocks b on b.id=u.block_id where u.condominium_id=$1 and u.id=$2`,
            [scope.condominiumId, v.unitId],
          );
          if (!unit) throw new BadRequestException('Unidade inválida.');
          const resident = v.residentId
            ? (
                await sql.query<{
                  full_name: string;
                  phone: string | null;
                  whatsapp_opt_in: boolean;
                }>(
                  'select full_name,phone,whatsapp_opt_in from public.residents where condominium_id=$1 and id=$2 and unit_id=$3 and active',
                  [scope.condominiumId, v.residentId, v.unitId],
                )
              )[0]
            : null;
          if (v.residentId && !resident)
            throw new BadRequestException('O morador não pertence à unidade.');
          if (v.ocrResultId) {
            const [ocr] = await sql.query(
              'select id from public.package_ocr_results where condominium_id=$1 and gatehouse_id=$2 and id=$3',
              [scope.condominiumId, v.gatehouseId, v.ocrResultId],
            );
            if (!ocr) throw new BadRequestException('Leitura de etiqueta inválida.');
          }
          const code = publicCode();
          const [pkg] = await sql.query<PackageRow>(
            `insert into public.packages(condominium_id,gatehouse_id,unit_id,resident_id,public_code,pickup_pin_hash,pickup_pin_lookup,recipient_name_raw,external_tracking_code,carrier,ocr_result_id,received_by_user_id,idempotency_key,request_hash)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
            [
              scope.condominiumId,
              v.gatehouseId,
              v.unitId,
              v.residentId,
              code,
              hash,
              pinLookup(pin, scope.condominiumId, v.gatehouseId, this.config.PIN_PEPPER),
              v.recipientNameRaw,
              v.externalTrackingCode || null,
              v.carrier || null,
              v.ocrResultId,
              scope.userId,
              v.idempotencyKey,
              requestHash,
            ],
          );
          if (!pkg) throw new Error('Insert failed');
          await recordEvent(sql, pkg, 'PACKAGE_CREATED', scope.userId);
          if (v.ocrResultId)
            await recordEvent(sql, pkg, 'OCR_PROCESSED', scope.userId, {
              ocrResultId: v.ocrResultId,
            });
          await recordEvent(sql, pkg, 'RECIPIENT_CONFIRMED', scope.userId, {
            unitId: v.unitId,
            residentId: v.residentId,
          });
          const [condo] = await sql.query<{ name: string }>(
            'select name from public.condominiums where id=$1',
            [scope.condominiumId],
          );
          const notify = Boolean(resident?.phone && resident.whatsapp_opt_in);
          const payload = notify
            ? encrypt(
                {
                  to: resident?.phone,
                  name: resident?.full_name,
                  condominium: condo?.name || '',
                  block: unit.block,
                  apartment: unit.apartment,
                  gatehouse: gate.name,
                  time: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                  pin,
                  publicCode: code,
                },
                this.config.OUTBOX_ENCRYPTION_KEY,
              )
            : null;
          await sql.query(
            'insert into public.notifications(condominium_id,gatehouse_id,package_id,provider,encrypted_payload,status,error_code) values($1,$2,$3,$4,$5,$6,$7)',
            [
              scope.condominiumId,
              v.gatehouseId,
              pkg.id,
              this.config.WHATSAPP_PROVIDER,
              payload,
              notify ? 'PENDING' : 'SKIPPED',
              notify ? null : 'NO_OPTED_IN_CONTACT',
            ],
          );
          await recordEvent(
            sql,
            pkg,
            notify ? 'NOTIFICATION_QUEUED' : 'NOTIFICATION_SKIPPED',
            scope.userId,
          );
          return {
            id: pkg.id,
            publicCode: code,
            pin,
            replayed: false,
            notificationStatus: notify ? 'PENDING' : 'SKIPPED',
          };
        });
      } catch (e) {
        if ((e as { code?: string }).code === '23505' && attempt < 3) continue;
        throw e;
      }
    }
    throw new ConflictException('Não foi possível gerar um código. Tente novamente.');
  }
  async search(scope: Scope, gate: string, q: string) {
    return this.db.transaction(scope.userId, async (sql) => {
      await this.gate(sql, scope.condominiumId, gate);
      return sql.query(
        `${packageSelect} where p.condominium_id=$1 and p.gatehouse_id=$2 and
    ($3='' or p.public_code ilike '%'||$3||'%' or p.recipient_name_raw ilike '%'||$3||'%' or p.external_tracking_code ilike '%'||$3||'%' or b.name||'/'||u.number ilike '%'||$3||'%') order by p.received_at desc limit 100`,
        [scope.condominiumId, gate, q],
      );
    });
  }
  async overview(scope: Scope, gate: string) {
    return this.db.transaction(scope.userId, async (sql) => {
      await this.gate(sql, scope.condominiumId, gate);
      return (
        await sql.query(
          "select count(*)::int as waiting from packages where condominium_id=$1 and gatehouse_id=$2 and status='WAITING_PICKUP'",
          [scope.condominiumId, gate],
        )
      )[0];
    });
  }
  async findPin(scope: Scope, gate: string, pin: string) {
    if (!/^\d{6}$/.test(pin)) throw new BadRequestException('Informe os seis dígitos.');
    await this.limit(scope, 'pin', 12);
    return this.db.transaction(scope.userId, async (sql) => {
      await this.gate(sql, scope.condominiumId, gate);
      const [pkg] = await sql.query<PackageRow>(
        "select * from public.packages where condominium_id=$1 and gatehouse_id=$2 and pickup_pin_lookup=$3 and status in ('WAITING_PICKUP','INCIDENT')",
        [
          scope.condominiumId,
          gate,
          pinLookup(pin, scope.condominiumId, gate, this.config.PIN_PEPPER),
        ],
      );
      if (!pkg || !(await verifyPin(pin, pkg.pickup_pin_hash)))
        throw new NotFoundException('Nenhuma encomenda disponível para este PIN nesta portaria.');
      return (await sql.query(`${packageSelect} where p.id=$1`, [pkg.id]))[0];
    });
  }
  async detail(scope: Scope, id: string) {
    return this.db.transaction(scope.userId, async (sql) => {
      const [pkg] = await sql.query(`${packageSelect} where p.id=$1 and p.condominium_id=$2`, [
        id,
        scope.condominiumId,
      ]);
      if (!pkg) throw new NotFoundException('Encomenda não encontrada.');
      const events = await sql.query(
        `select e.id,e.type,e.created_at,e.detail,pr.display_name as actor_name from public.package_events e left join public.profiles pr on pr.id=e.actor_id where e.package_id=$1 order by e.sequence_no`,
        [id],
      );
      let fakeMessage: string | null = null;
      if (this.config.APP_MODE === 'demo') {
        const [n] = await sql.query<{ encrypted_payload: string | null }>(
          "select encrypted_payload from public.notifications where package_id=$1 and provider='fake' and payload_expires_at>now()",
          [id],
        );
        if (n?.encrypted_payload) {
          const p = notificationPayloadSchema.parse(
            decrypt(n.encrypted_payload, this.config.OUTBOX_ENCRYPTION_KEY),
          );
          fakeMessage = `Olá, ${p.name}. Sua encomenda chegou ao Condomínio ${p.condominium}. Bloco ${p.block} • Apto ${p.apartment}. ${p.gatehouse}. Recebida às ${p.time}. Código de retirada: ${p.pin}`;
        }
      }
      return { package: pkg, events, fakeMessage };
    });
  }
  async command(scope: Scope, id: string, input: unknown) {
    const v = commandSchema.parse(input);
    return this.db.transaction(scope.userId, async (sql) => {
      const [pkg] = await sql.query<PackageRow>(
        'select * from public.packages where id=$1 and condominium_id=$2 for update',
        [id, scope.condominiumId],
      );
      if (!pkg) throw new NotFoundException('Encomenda não encontrada.');
      const next = transition(pkg.status, v.command);
      await sql.query(
        `update public.packages set status=$1,picked_up_at=case when $1='PICKED_UP' then now() else picked_up_at end,picked_up_by_user_id=case when $1='PICKED_UP' then $2::uuid else picked_up_by_user_id end where id=$3`,
        [next, scope.userId, id],
      );
      await recordEvent(
        sql,
        pkg,
        {
          pickup: 'PICKUP_COMPLETED',
          cancel: 'PACKAGE_CANCELED',
          incident: 'INCIDENT_CREATED',
          resolve: 'INCIDENT_RESOLVED',
          return: 'PACKAGE_RETURNED',
        }[v.command],
        scope.userId,
        'reason' in v ? { reason: v.reason } : {},
      );
      return { id, status: next };
    });
  }
}
export type { ReceiveInput };
