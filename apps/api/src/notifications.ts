import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Config } from './config';
import { Database } from './db';
import { decrypt } from './domain';
import { recordEvent } from './events';
export const notificationPayloadSchema = z.object({
  to: z.string(),
  name: z.string(),
  condominium: z.string(),
  block: z.string(),
  apartment: z.string(),
  gatehouse: z.string(),
  time: z.string(),
  pin: z.string(),
  publicCode: z.string(),
});
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;
export interface WhatsAppProvider {
  send(payload: NotificationPayload): Promise<string>;
}
export class FakeWhatsAppProvider implements WhatsAppProvider {
  async send(_payload: NotificationPayload) {
    return `fake-${randomUUID()}`;
  }
}
export class MetaWhatsAppProvider implements WhatsAppProvider {
  constructor(private config: Config) {}
  async send(p: NotificationPayload) {
    if (p.to.startsWith('+550000')) throw new Error('FICTIONAL_CONTACT');
    const r = await fetch(
      `https://graph.facebook.com/${this.config.META_GRAPH_VERSION}/${this.config.META_WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.META_WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: p.to.replace('+', ''),
          type: 'template',
          template: {
            name: this.config.META_TEMPLATE_NAME,
            language: { code: 'pt_BR' },
            components: [
              {
                type: 'body',
                parameters: [
                  p.name,
                  p.condominium,
                  p.block,
                  p.apartment,
                  p.gatehouse,
                  p.time,
                  p.pin,
                ].map((text) => ({ type: 'text', text })),
              },
            ],
          },
        }),
      },
    );
    if (!r.ok) throw new Error(`META_HTTP_${r.status}`);
    const data = z
      .object({ messages: z.array(z.object({ id: z.string() })).min(1) })
      .parse(await r.json());
    return data.messages[0]!.id;
  }
}
type Job = {
  id: string;
  condominium_id: string;
  gatehouse_id: string;
  package_id: string;
  encrypted_payload: string;
  attempts: number;
  lease_token: string;
};
export class NotificationWorker {
  private busy = false;
  constructor(
    private db: Database,
    private config: Config,
    private provider: WhatsAppProvider,
  ) {}
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      // Payloads are short-lived. No PINs or phone numbers are written to technical logs.
      const jobs = await this.db.transaction(
        null,
        async (sql) => {
          const obsolete = await sql.query<Job>(
            `update public.notifications n set status='SKIPPED',encrypted_payload=null,error_code='PACKAGE_CLOSED',updated_at=now() from public.packages p where p.id=n.package_id and p.status in ('PICKED_UP','CANCELED','RETURNED') and n.status in ('PENDING','FAILED') and (n.lease_until is null or n.lease_until<now()) returning n.*`,
          );
          for (const job of obsolete)
            await recordEvent(
              sql,
              {
                id: job.package_id,
                condominium_id: job.condominium_id,
                gatehouse_id: job.gatehouse_id,
              },
              'NOTIFICATION_SKIPPED',
              null,
              { code: 'PACKAGE_CLOSED' },
            );
          await sql.query(
            `update public.notifications set encrypted_payload=null,status=case when status in ('PENDING','FAILED') then 'FAILED' else status end,error_code=case when status in ('PENDING','FAILED') then 'PAYLOAD_EXPIRED' else error_code end,attempts=case when status in ('PENDING','FAILED') then 5 else attempts end where payload_expires_at<now() and encrypted_payload is not null`,
          );
          return sql.query<Job>(`with due as(select id from public.notifications where status in ('PENDING','FAILED') and attempts<5 and available_at<=now() and (lease_until is null or lease_until<now()) and encrypted_payload is not null order by available_at for update skip locked limit 5)
        update public.notifications n set lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid(),attempts=n.attempts+1 from due where n.id=due.id returning n.*`);
        },
        true,
      );
      for (const job of jobs) {
        let messageId: string | null = null;
        let error: string | null = null;
        try {
          messageId = await this.provider.send(
            notificationPayloadSchema.parse(
              decrypt(job.encrypted_payload, this.config.OUTBOX_ENCRYPTION_KEY),
            ),
          );
        } catch (e) {
          error =
            e instanceof Error && /^(META_HTTP_\d+|FICTIONAL_CONTACT)$/.test(e.message)
              ? e.message
              : 'PROVIDER_UNAVAILABLE';
        }
        await this.db.transaction(
          null,
          async (sql) => {
            const rows = await sql.query(
              `update public.notifications set status=$1,provider_message_id=$2,error_code=$3,lease_until=null,lease_token=null,available_at=now()+($4::integer*interval '1 second'),updated_at=now(),encrypted_payload=case when $5 then null else encrypted_payload end where id=$6 and lease_token=$7 returning id`,
              [
                error ? 'FAILED' : 'SENT',
                messageId,
                error,
                Math.min(3600, 30 * 2 ** job.attempts),
                !error && this.config.WHATSAPP_PROVIDER === 'meta',
                job.id,
                job.lease_token,
              ],
            );
            if (rows.length)
              await recordEvent(
                sql,
                {
                  id: job.package_id,
                  condominium_id: job.condominium_id,
                  gatehouse_id: job.gatehouse_id,
                },
                error ? 'NOTIFICATION_FAILED' : 'NOTIFICATION_SENT',
                null,
                { attempt: job.attempts, ...(error ? { code: error } : {}) },
              );
          },
          true,
        );
      }
    } finally {
      this.busy = false;
    }
  }
  async delivery(messageId: string, status: 'delivered' | 'read' | 'failed') {
    return this.db.transaction(
      null,
      async (sql) => {
        const [job] = await sql.query<Job & { status: string }>(
          'select * from public.notifications where provider_message_id=$1 for update',
          [messageId],
        );
        if (!job) return;
        const next = status.toUpperCase();
        const ranks: Record<string, number> = {
          PENDING: 0,
          FAILED: 0,
          SENT: 1,
          DELIVERED: 2,
          READ: 3,
        };
        if (
          job.status === next ||
          job.status === 'READ' ||
          (status === 'failed' && job.status === 'DELIVERED') ||
          (status !== 'failed' && (ranks[job.status] || 0) >= (ranks[next] || 0))
        )
          return;
        await sql.query(
          "update public.notifications set status=$1,attempts=case when $1='FAILED' then 5 else attempts end,updated_at=now() where id=$2",
          [next, job.id],
        );
        await recordEvent(
          sql,
          {
            id: job.package_id,
            condominium_id: job.condominium_id,
            gatehouse_id: job.gatehouse_id,
          },
          `NOTIFICATION_${next}`,
          null,
        );
      },
      true,
    );
  }
}
