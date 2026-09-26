import type { Role, PackageStatus } from '@sc/validation';
export interface Gatehouse {
  id: string;
  name: string;
  condominium_id: string;
}
export interface Membership {
  condominium_id: string;
  name: string;
  role: Role;
}
export interface SessionContext {
  userId: string;
  displayName: string;
  memberships: Membership[];
  gatehouses: Gatehouse[];
  demo: boolean;
}
export interface Candidate {
  id: string;
  full_name: string;
  unit_id: string;
  block: string;
  apartment: string;
  score: number;
}
export interface Unit {
  id: string;
  block: string;
  number: string;
  block_id: string;
}
export interface PackageView {
  id: string;
  public_code: string;
  recipient_name_raw: string;
  status: PackageStatus;
  received_at: string;
  picked_up_at: string | null;
  block: string;
  apartment: string;
  gatehouse: string;
  gatehouse_id: string;
  external_tracking_code: string | null;
  notification_status: string | null;
}
export interface PackageEvent {
  id: string;
  type: string;
  created_at: string;
  actor_name: string | null;
  detail: Record<string, unknown>;
}
export interface PackageDetail {
  package: PackageView;
  events: PackageEvent[];
  fakeMessage?: string | null;
}
