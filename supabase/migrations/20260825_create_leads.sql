-- Lead2Job AI — initial persistent leads schema
-- Safe default: RLS enabled, no public policies. Server-side service role only.

create extension if not exists pgcrypto;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 160),
  service text not null check (char_length(trim(service)) between 1 and 200),
  value numeric(12,2) not null default 0 check (value >= 0),
  status text not null default 'new' check (status in ('new','followup','approved','won','lost')),
  source text not null default 'dashboard' check (char_length(source) between 1 and 80),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

alter table public.leads enable row level security;

-- Intentionally no anon/authenticated policies here.
-- The Vercel serverless API will use SUPABASE_SERVICE_ROLE_KEY server-side.
