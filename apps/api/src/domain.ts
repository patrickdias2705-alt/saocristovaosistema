import {
  createHmac,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { promisify } from 'node:util';
import { ConflictException } from '@nestjs/common';
import type { PackageCommand, PackageStatus } from '@sc/validation';
const scrypt = promisify(scryptCallback);
export const publicCode = () => `SC-${randomBytes(8).toString('hex').slice(0, 12).toUpperCase()}`;
export const newPin = () => String(randomInt(0, 1000000)).padStart(6, '0');
export function pinLookup(pin: string, condo: string, gate: string, pepper: string) {
  return createHmac('sha256', pepper).update(`${condo}:${gate}:${pin}`).digest('hex');
}
export async function hashPin(pin: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${((await scrypt(pin, salt, 32)) as Buffer).toString('hex')}`;
}
export async function verifyPin(pin: string, hash: string) {
  const [salt, digest] = hash.split(':');
  if (!salt || !digest) return false;
  const actual = (await scrypt(pin, salt, 32)) as Buffer;
  const expected = Buffer.from(digest, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function encrypt(value: unknown, key: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const data = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}
export function decrypt(value: string, key: string): unknown {
  const b = Buffer.from(value, 'base64');
  const c = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), b.subarray(0, 12));
  c.setAuthTag(b.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([c.update(b.subarray(28)), c.final()]).toString('utf8'),
  ) as unknown;
}
export function transition(
  status: PackageStatus,
  command: PackageCommand['command'],
): PackageStatus {
  const allowed: Partial<
    Record<PackageStatus, Partial<Record<PackageCommand['command'], PackageStatus>>>
  > = {
    WAITING_PICKUP: {
      pickup: 'PICKED_UP',
      cancel: 'CANCELED',
      incident: 'INCIDENT',
      return: 'RETURNED',
    },
    INCIDENT: { resolve: 'WAITING_PICKUP', cancel: 'CANCELED', return: 'RETURNED' },
  };
  const next = allowed[status]?.[command];
  if (!next)
    throw new ConflictException('Esta encomenda não permite essa operação no estado atual.');
  return next;
}
export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
export function nameSimilarity(a: string, b: string) {
  const left = new Set(normalize(a).split(' ').filter(Boolean));
  const right = new Set(normalize(b).split(' ').filter(Boolean));
  if (!left.size || !right.size) return 0;
  return (2 * [...left].filter((t) => right.has(t)).length) / (left.size + right.size);
}
export function matchScore(
  candidate: { full_name: string; block: string; apartment: string },
  input: { name: string; block: string; apartment: string },
) {
  const eq = (a: string, b: string) =>
    normalize(a).replace(/^0+/, '') === normalize(b).replace(/^0+/, '');
  const name = nameSimilarity(candidate.full_name, input.name);
  if (input.block && input.apartment) {
    if (eq(candidate.block, input.block) && eq(candidate.apartment, input.apartment))
      return Math.round(75 + name * 25);
    return Math.round(name * 40);
  }
  return Math.round(
    name * 60 +
      (input.apartment && eq(candidate.apartment, input.apartment) ? 15 : 0) +
      (input.block && eq(candidate.block, input.block) ? 10 : 0),
  );
}
