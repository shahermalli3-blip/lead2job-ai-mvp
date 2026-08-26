-- Lead2Job AI — core CRM schema
-- Safe default: RLS enabled, no public policies. Server-side service role only.

create extension if not exists pgcrypto;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text,
  phone text,
  email text,
  channel text not null default 'manual' check (channel in ('phone','whatsapp','email','website','manual')),
  service_type text,
  description text,
  address text,
  city text,
  urgency text default 'normal' check (urgency in ('low','normal','high','emergency')),
  preferred_time text,
  status text not null default 'new' check (status in ('new','qualified','booked','quote_sent','follow_up','won','lost')),
  estimated_value_min numeric(12,2),
  estimated_value_max numeric(12,2),
  notes text
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  type text not null,
  channel text,
  direction text check (direction in ('inbound','outbound')),
  content text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'EUR',
  status text not null default 'draft' check (status in ('draft','sent','accepted','rejected','expired')),
  sent_at timestamptz,
  valid_until date,
  notes text
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'booked' check (status in ('booked','confirmed','completed','cancelled','no_show')),
  external_calendar_id text,
  notes text
);

create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  due_at timestamptz not null,
  channel text not null default 'whatsapp',
  status text not null default 'pending' check (status in ('pending','sent','cancelled','failed')),
  message text,
  sent_at timestamptz
);

create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_created_at_idx on public.leads(created_at desc);
create index if not exists activities_lead_id_idx on public.activities(lead_id);
create index if not exists quotes_lead_id_idx on public.quotes(lead_id);
create index if not exists appointments_lead_id_idx on public.appointments(lead_id);
create index if not exists follow_ups_due_idx on public.follow_ups(status, due_at);

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
alter table public.activities enable row level security;
alter table public.quotes enable row level security;
alter table public.appointments enable row level security;
alter table public.follow_ups enable row level security;

-- Intentionally no anon/authenticated policies here.
-- The Vercel serverless API uses SUPABASE_SERVICE_ROLE_KEY server-side.