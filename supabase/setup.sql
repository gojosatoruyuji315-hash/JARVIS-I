-- JARVIS-X accounts: run this once in your Supabase project
-- (Dashboard → SQL Editor → New query → paste → Run).
-- Each signed-in person gets one private row holding their saved progress.

create table if not exists public.jarvis_vault (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);

-- Only the owner can see or change their row.
alter table public.jarvis_vault enable row level security;
drop policy if exists "Own progress only" on public.jarvis_vault;
create policy "Own progress only" on public.jarvis_vault
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.jarvis_vault to authenticated;
revoke all on public.jarvis_vault from anon;

-- Lets people delete their own account (and, through the cascade, their saved progress).
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
