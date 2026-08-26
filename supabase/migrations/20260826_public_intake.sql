create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  insert into public.inboxes (owner_id, name)
  values (new.id, 'Website')
  on conflict do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create unique index if not exists inboxes_one_default_name_per_owner on public.inboxes(owner_id, name);
create index if not exists inboxes_public_token_idx on public.inboxes(public_token) where enabled = true;
