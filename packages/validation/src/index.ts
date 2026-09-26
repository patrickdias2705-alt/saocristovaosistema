import { z } from 'zod';
export const roleSchema = z.enum([
  'SUPER_ADMIN',
  'CONDO_ADMIN',
  'GATEHOUSE_SUPERVISOR',
  'GATEHOUSE_OPERATOR',
]);
export const statusSchema = z.enum([
  'WAITING_PICKUP',
  'PICKED_UP',
  'RETURNED',
  'CANCELED',
  'INCIDENT',
]);
export const receiveSchema = z
  .object({
    gatehouseId: z.uuid(),
    unitId: z.uuid(),
    residentId: z.uuid().nullable(),
    recipientNameRaw: z.string().trim().min(3).max(160),
    externalTrackingCode: z.string().trim().max(100).default(''),
    carrier: z.string().trim().max(80).default(''),
    ocrResultId: z.uuid().nullable().default(null),
    recipientConfirmed: z.literal(true),
    idempotencyKey: z.uuid(),
  })
  .strict();
export const commandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('pickup'), recipientChecked: z.literal(true) }).strict(),
  z
    .object({
      command: z.enum(['cancel', 'incident', 'resolve', 'return']),
      reason: z.string().trim().min(5).max(500),
    })
    .strict(),
]);
const field = z.object({ value: z.string().nullable(), confidence: z.number().min(0).max(1) });
export const ocrSchema = z.object({
  recipientName: field,
  block: field,
  apartment: field,
  trackingCode: field,
  carrier: field,
  address: field,
  rawText: z.string().max(20000),
  processingTime: z.number(),
  requestId: z.uuid(),
  provider: z.string(),
});
export const matchSchema = z.object({
  name: z.string().max(160).default(''),
  block: z.string().max(30).default(''),
  apartment: z.string().max(30).default(''),
});
export const residentSchema = z
  .object({
    unitId: z.uuid(),
    fullName: z.string().trim().min(3).max(160),
    phone: z
      .string()
      .regex(/^\+[1-9]\d{9,14}$/)
      .nullable(),
    whatsappOptIn: z.boolean(),
  })
  .strict();
export const unitSchema = z
  .object({ blockId: z.uuid(), number: z.string().trim().min(1).max(30) })
  .strict();
export const memberSchema = z
  .object({
    userId: z.uuid(),
    role: roleSchema.exclude(['SUPER_ADMIN']),
    gatehouseIds: z.array(z.uuid()).max(30),
  })
  .strict();
export type ReceiveInput = z.infer<typeof receiveSchema>;
export type PackageCommand = z.infer<typeof commandSchema>;
export type OCRResult = z.infer<typeof ocrSchema>;
export type Role = z.infer<typeof roleSchema>;
export type PackageStatus = z.infer<typeof statusSchema>;
