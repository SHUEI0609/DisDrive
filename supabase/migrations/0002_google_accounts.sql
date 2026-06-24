create table public.google_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  google_sub text,
  email text,
  refresh_token_encrypted text not null,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index google_accounts_user_id_idx on public.google_accounts(user_id);

create trigger google_accounts_set_updated_at
  before update on public.google_accounts
  for each row execute function public.set_updated_at();

alter table public.google_accounts enable row level security;
