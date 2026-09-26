import { randomUUID } from 'node:crypto';
import { DEMO_USERS, CONDO, GATE } from './db';
import { PackageService } from './packages';
export async function seedDemoPackages(packages: PackageService, userId = DEMO_USERS.admin) {
  const scope = { userId, condominiumId: CONDO };
  const existing = await packages.search(scope, GATE, '');
  if (existing.length) return;
  for (const [name, unit, resident, command] of [
    [
      'Maria Aparecida Silva',
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      '',
    ],
    [
      'João Carlos Souza',
      '40000000-0000-4000-8000-000000000003',
      '50000000-0000-4000-8000-000000000004',
      'pickup',
    ],
    [
      'Maria Silva Santos',
      '40000000-0000-4000-8000-000000000002',
      '50000000-0000-4000-8000-000000000003',
      'incident',
    ],
  ]) {
    const p = await packages.receive(scope, {
      gatehouseId: GATE,
      unitId: unit,
      residentId: resident,
      recipientNameRaw: name,
      recipientConfirmed: true,
      idempotencyKey: randomUUID(),
    });
    if (command)
      await packages.command(
        scope,
        p.id,
        command === 'pickup'
          ? { command, recipientChecked: true }
          : { command, reason: 'Etiqueta de demonstração com embalagem avariada.' },
      );
  }
}
