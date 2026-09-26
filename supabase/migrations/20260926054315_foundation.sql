-- Browser roles have no direct business-table access. The Nest API uses sc_api.
create role sc_api nologin nobypassrls;
create role sc_worker nologin nobypassrls;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema public, private, auth to sc_api, sc_worker;
grant execute on function auth.uid() to sc_api, sc_worker;

create table public.profiles (
  id uuid primary key references auth.users(id),
  display_name text not null check(length(display_name) between 2 and 160),
  is_super_admin boolean not null default false,
  active boolean not null default true
);
create table public.condominiums (
  id uuid primary key default gen_random_uuid(), name text not null,
  timezone text not null default 'America/Sao_Paulo', created_at timestamptz not null default now()
);
create table public.memberships (
  condominium_id uuid not null references public.condominiums(id),
  user_id uuid not null references public.profiles(id),
  role text not null check(role in ('CONDO_ADMIN','GATEHOUSE_SUPERVISOR','GATEHOUSE_OPERATOR')),
  active boolean not null default true,
  primary key(condominium_id,user_id)
);
create index memberships_user_idx on public.memberships(user_id,condominium_id);
create table public.gatehouses (
  id uuid primary key default gen_random_uuid(), condominium_id uuid not null references public.condominiums(id),
  name text not null, unique(condominium_id,id), unique(condominium_id,name)
);
create table public.user_gatehouses (
  condominium_id uuid not null, user_id uuid not null, gatehouse_id uuid not null,
  primary key(condominium_id,user_id,gatehouse_id),
  foreign key(condominium_id,user_id) references public.memberships(condominium_id,user_id),
  foreign key(condominium_id,gatehouse_id) references public.gatehouses(condominium_id,id)
);
create index user_gatehouses_gate_idx on public.user_gatehouses(condominium_id,gatehouse_id);
create table public.blocks (
  id uuid primary key default gen_random_uuid(), condominium_id uuid not null references public.condominiums(id),
  name text not null, unique(condominium_id,id), unique(condominium_id,name)
);
create table public.units (
  id uuid primary key default gen_random_uuid(), condominium_id uuid not null, block_id uuid not null,
  number text not null, unique(condominium_id,id), unique(condominium_id,block_id,number),
  foreign key(condominium_id,block_id) references public.blocks(condominium_id,id)
);
create table public.residents (
  id uuid primary key default gen_random_uuid(), condominium_id uuid not null, unit_id uuid not null,
  full_name text not null, phone text check(phone is null or phone ~ '^\+[1-9][0-9]{9,14}$'),
  whatsapp_opt_in boolean not null default false, active boolean not null default true,
  unique(condominium_id,id), unique(condominium_id,id,unit_id),
  foreign key(condominium_id,unit_id) references public.units(condominium_id,id)
);
create index residents_unit_idx on public.residents(condominium_id,unit_id);
create table public.package_ocr_results (
  id uuid primary key, condominium_id uuid not null, gatehouse_id uuid not null,
  created_by uuid not null references public.profiles(id),
  fields jsonb not null, provider text not null, processing_ms integer not null,
  image_path text, image_expires_at timestamptz,
  created_at timestamptz not null default now(), unique(condominium_id,id,gatehouse_id),
  foreign key(condominium_id,gatehouse_id) references public.gatehouses(condominium_id,id)
);
create index ocr_actor_idx on public.package_ocr_results(created_by);
create table public.packages (
  id uuid primary key default gen_random_uuid(), condominium_id uuid not null, gatehouse_id uuid not null,
  unit_id uuid not null, resident_id uuid,
  public_code text not null unique check(public_code ~ '^SC-[A-Z0-9]{12}$'),
  pickup_pin_hash text not null, pickup_pin_lookup text not null,
  recipient_name_raw text not null, external_tracking_code text, carrier text,
  status text not null default 'WAITING_PICKUP' check(status in ('WAITING_PICKUP','PICKED_UP','CANCELED','RETURNED','INCIDENT')),
  ocr_result_id uuid, received_at timestamptz not null default now(), received_by_user_id uuid not null references public.profiles(id),
  picked_up_at timestamptz, picked_up_by_user_id uuid references public.profiles(id),
  updated_at timestamptz not null default now(), idempotency_key uuid not null, request_hash text not null,
  unique(condominium_id,id,gatehouse_id), unique(condominium_id,received_by_user_id,idempotency_key),
  foreign key(condominium_id,gatehouse_id) references public.gatehouses(condominium_id,id),
  foreign key(condominium_id,unit_id) references public.units(condominium_id,id),
  foreign key(condominium_id,resident_id,unit_id) references public.residents(condominium_id,id,unit_id),
  foreign key(condominium_id,ocr_result_id,gatehouse_id) references public.package_ocr_results(condominium_id,id,gatehouse_id),
  check ((status='PICKED_UP') = (picked_up_at is not null and picked_up_by_user_id is not null))
);
create unique index packages_active_pin_idx on public.packages(condominium_id,gatehouse_id,pickup_pin_lookup) where status in ('WAITING_PICKUP','INCIDENT');
create index packages_queue_idx on public.packages(condominium_id,gatehouse_id,status,received_at desc);
create index packages_unit_idx on public.packages(condominium_id,unit_id);
create index packages_resident_idx on public.packages(condominium_id,resident_id,unit_id);
create index packages_ocr_idx on public.packages(condominium_id,ocr_result_id,gatehouse_id);
create index packages_received_by_idx on public.packages(received_by_user_id);
create index packages_picked_by_idx on public.packages(picked_up_by_user_id);
create table public.package_events (
  id uuid primary key default gen_random_uuid(), sequence_no bigint generated always as identity,
  condominium_id uuid not null, gatehouse_id uuid not null, package_id uuid not null,
  type text not null, actor_id uuid references public.profiles(id), detail jsonb not null default '{}', created_at timestamptz not null default now(),
  foreign key(condominium_id,package_id,gatehouse_id) references public.packages(condominium_id,id,gatehouse_id)
);
create index package_events_package_idx on public.package_events(condominium_id,package_id,gatehouse_id,created_at);
create index package_events_actor_idx on public.package_events(actor_id);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), condominium_id uuid not null references public.condominiums(id),
  gatehouse_id uuid, actor_id uuid references public.profiles(id), action text not null, entity_id uuid,
  detail jsonb not null default '{}', created_at timestamptz not null default now(),
  foreign key(condominium_id,gatehouse_id) references public.gatehouses(condominium_id,id)
);
create index audit_scope_idx on public.audit_logs(condominium_id,gatehouse_id,created_at desc);
create index audit_actor_idx on public.audit_logs(actor_id);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), condominium_id uuid not null, gatehouse_id uuid not null, package_id uuid not null,
  status text not null default 'PENDING' check(status in ('PENDING','FAILED','SENT','DELIVERED','READ','SKIPPED')),
  encrypted_payload text, payload_expires_at timestamptz not null default now()+interval '24 hours',
  provider text not null, provider_message_id text unique,
  attempts integer not null default 0, available_at timestamptz not null default now(), lease_until timestamptz,
  lease_token uuid, error_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(package_id), foreign key(condominium_id,package_id,gatehouse_id) references public.packages(condominium_id,id,gatehouse_id)
);
create index notifications_due_idx on public.notifications(available_at) where status in ('PENDING','FAILED');
create index notifications_scope_idx on public.notifications(condominium_id,package_id,gatehouse_id);
create table public.rate_limits (
  key text primary key, hits integer not null, expires_at timestamptz not null
);

-- Internal, fixed-search-path permission helpers; not exposed in PostgREST.
create function private.is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and exists(select 1 from public.profiles where id=(select auth.uid()) and active and is_super_admin)
$$;
create function private.is_member(c uuid) returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and (private.is_platform_admin() or exists(
    select 1 from public.memberships m join public.profiles p on p.id=m.user_id
    where m.condominium_id=c and m.user_id=(select auth.uid()) and m.active and p.active))
$$;
create function private.is_admin(c uuid) returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and (private.is_platform_admin() or exists(
    select 1 from public.memberships m join public.profiles p on p.id=m.user_id
    where m.condominium_id=c and m.user_id=(select auth.uid()) and m.active and p.active and m.role='CONDO_ADMIN'))
$$;
create function private.can_gate(c uuid,g uuid) returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and private.is_member(c) and (private.is_admin(c) or exists(
    select 1 from public.user_gatehouses where condominium_id=c and user_id=(select auth.uid()) and gatehouse_id=g))
$$;
revoke all on all functions in schema private from public;
grant execute on all functions in schema private to sc_api;

do $$ declare t text; begin
  foreach t in array array['profiles','condominiums','memberships','gatehouses','user_gatehouses','blocks','units','residents','packages','package_ocr_results','package_events','notifications','audit_logs','rate_limits'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
  end loop;
end $$;
grant select on public.profiles, public.condominiums, public.memberships, public.gatehouses, public.user_gatehouses, public.blocks, public.units, public.residents, public.packages, public.package_ocr_results, public.package_events, public.notifications, public.audit_logs to sc_api;
grant insert on public.packages, public.package_ocr_results, public.package_events, public.notifications, public.audit_logs, public.residents, public.units, public.memberships, public.user_gatehouses to sc_api;
grant update on public.packages, public.residents, public.memberships to sc_api;
grant delete on public.user_gatehouses to sc_api;
grant select,insert,update,delete on public.rate_limits to sc_api;
grant select,update on public.notifications, public.package_ocr_results to sc_worker;
grant select on public.packages to sc_worker;
grant insert on public.package_events, public.audit_logs to sc_worker;

create policy profiles_read on public.profiles for select to sc_api using(id=(select auth.uid()) or private.is_platform_admin() or exists(select 1 from public.memberships m where m.user_id=id and private.is_member(m.condominium_id)));
create policy condominiums_read on public.condominiums for select to sc_api using(private.is_member(id));
create policy memberships_read on public.memberships for select to sc_api using(user_id=(select auth.uid()) or private.is_admin(condominium_id));
create policy memberships_insert on public.memberships for insert to sc_api with check(private.is_admin(condominium_id));
create policy memberships_update on public.memberships for update to sc_api using(private.is_admin(condominium_id)) with check(private.is_admin(condominium_id));
create policy gates_read on public.gatehouses for select to sc_api using(private.can_gate(condominium_id,id));
create policy user_gates_read on public.user_gatehouses for select to sc_api using(user_id=(select auth.uid()) or private.is_admin(condominium_id));
create policy user_gates_insert on public.user_gatehouses for insert to sc_api with check(private.is_admin(condominium_id));
create policy user_gates_delete on public.user_gatehouses for delete to sc_api using(private.is_admin(condominium_id));
create policy blocks_read on public.blocks for select to sc_api using(private.is_member(condominium_id));
do $$ declare t text; begin
  foreach t in array array['units','residents'] loop
    execute format('create policy tenant_read on public.%I for select to sc_api using(private.is_member(condominium_id))',t);
    execute format('create policy admin_insert on public.%I for insert to sc_api with check(private.is_admin(condominium_id))',t);
  end loop;
  foreach t in array array['packages','package_ocr_results','package_events','notifications'] loop
    execute format('create policy gate_read on public.%I for select to sc_api using(private.can_gate(condominium_id,gatehouse_id))',t);
    execute format('create policy gate_insert on public.%I for insert to sc_api with check(private.can_gate(condominium_id,gatehouse_id))',t);
  end loop;
end $$;
create policy residents_update on public.residents for update to sc_api using(private.is_admin(condominium_id)) with check(private.is_admin(condominium_id));
create policy packages_update on public.packages for update to sc_api using(private.can_gate(condominium_id,gatehouse_id)) with check(private.can_gate(condominium_id,gatehouse_id));
create policy audit_read on public.audit_logs for select to sc_api using(private.is_admin(condominium_id));
create policy audit_insert on public.audit_logs for insert to sc_api with check(private.is_admin(condominium_id) or private.can_gate(condominium_id,gatehouse_id));
create policy rates_own on public.rate_limits for all to sc_api using(key like (select auth.uid())::text || ':%') with check(key like (select auth.uid())::text || ':%');
create policy worker_notify_read on public.notifications for select to sc_worker using(true);
create policy worker_notify_update on public.notifications for update to sc_worker using(true) with check(true);
create policy worker_packages_read on public.packages for select to sc_worker using(true);
create policy worker_ocr_read on public.package_ocr_results for select to sc_worker using(true);
create policy worker_ocr_update on public.package_ocr_results for update to sc_worker using(true) with check(true);
create policy worker_events on public.package_events for insert to sc_worker with check(true);
create policy worker_audit on public.audit_logs for insert to sc_worker with check(true);

create function private.immutable_history() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Operational history is immutable' using errcode='42501'; end $$;
create trigger events_immutable before update or delete on public.package_events for each row execute function private.immutable_history();
create trigger audit_immutable before update or delete on public.audit_logs for each row execute function private.immutable_history();
create function private.valid_package_transition() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.condominium_id,new.gatehouse_id,new.unit_id,new.resident_id,new.received_by_user_id,new.public_code,new.pickup_pin_hash,new.pickup_pin_lookup)
    is distinct from (old.condominium_id,old.gatehouse_id,old.unit_id,old.resident_id,old.received_by_user_id,old.public_code,old.pickup_pin_hash,old.pickup_pin_lookup) then
    raise exception 'Package identity is immutable' using errcode='23514';
  end if;
  if new.status<>old.status and not (
    (old.status='WAITING_PICKUP' and new.status in ('PICKED_UP','CANCELED','RETURNED','INCIDENT')) or
    (old.status='INCIDENT' and new.status in ('WAITING_PICKUP','CANCELED','RETURNED'))
  ) then raise exception 'Invalid package transition' using errcode='23514'; end if;
  new.updated_at=now(); return new;
end $$;
create trigger package_transition before update on public.packages for each row execute function private.valid_package_transition();

revoke execute on all functions in schema private from public;
grant execute on function private.is_platform_admin(), private.is_member(uuid), private.is_admin(uuid), private.can_gate(uuid,uuid) to sc_api;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('ocr-labels','ocr-labels',false,8388608,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
-- No browser storage policies: upload/read only through scoped API after authorization.
