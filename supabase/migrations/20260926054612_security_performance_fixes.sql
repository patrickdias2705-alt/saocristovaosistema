-- Harden helper privileges and optimize the RLS predicates flagged by Supabase advisors.
create index if not exists package_ocr_scope_idx
  on public.package_ocr_results(condominium_id, gatehouse_id);

create or replace function private.is_platform_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and exists(
    select 1 from public.profiles
    where id=(select auth.uid()) and active and is_super_admin
  )
$$;

create or replace function private.is_member(c uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and (
    private.is_platform_admin() or exists(
      select 1
      from public.memberships m
      join public.profiles p on p.id=m.user_id
      where m.condominium_id=c
        and m.user_id=(select auth.uid())
        and m.active
        and p.active
    )
  )
$$;

create or replace function private.is_admin(c uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and (
    private.is_platform_admin() or exists(
      select 1
      from public.memberships m
      join public.profiles p on p.id=m.user_id
      where m.condominium_id=c
        and m.user_id=(select auth.uid())
        and m.active
        and p.active
        and m.role='CONDO_ADMIN'
    )
  )
$$;

create or replace function private.can_gate(c uuid,g uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null
    and private.is_member(c)
    and (
      private.is_admin(c) or exists(
        select 1
        from public.user_gatehouses
        where condominium_id=c
          and user_id=(select auth.uid())
          and gatehouse_id=g
      )
    )
$$;

drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to sc_api
using(
  id=(select auth.uid())
  or private.is_platform_admin()
  or exists(
    select 1 from public.memberships m
    where m.user_id=id and private.is_member(m.condominium_id)
  )
);

drop policy memberships_read on public.memberships;
create policy memberships_read on public.memberships for select to sc_api
using(user_id=(select auth.uid()) or private.is_admin(condominium_id));

drop policy user_gates_read on public.user_gatehouses;
create policy user_gates_read on public.user_gatehouses for select to sc_api
using(user_id=(select auth.uid()) or private.is_admin(condominium_id));

drop policy rates_own on public.rate_limits;
create policy rates_own on public.rate_limits for all to sc_api
using(key like (select auth.uid())::text || ':%')
with check(key like (select auth.uid())::text || ':%');

revoke execute on all functions in schema private from public;
grant execute on function private.is_platform_admin(), private.is_member(uuid), private.is_admin(uuid), private.can_gate(uuid,uuid) to sc_api;

-- This platform event-trigger function is not an application RPC.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$$;
