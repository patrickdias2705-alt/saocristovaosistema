-- Preserve causal order when several events are committed in one transaction.
alter table public.package_events
  add column if not exists sequence_no bigint generated always as identity;

create unique index if not exists package_events_sequence_idx
  on public.package_events(sequence_no);
