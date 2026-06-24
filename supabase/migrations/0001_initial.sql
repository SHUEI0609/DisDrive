create extension if not exists pgcrypto;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text not null unique,
  username text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.guilds (
  id uuid primary key default gen_random_uuid(),
  discord_guild_id text not null unique,
  name text not null,
  icon_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references public.guilds(id) on delete cascade,
  discord_channel_id text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references public.users(id),
  guild_id uuid not null references public.guilds(id),
  channel_id uuid not null references public.channels(id),
  provider text not null check (provider in ('google_drive', 'cloudflare_r2')),
  storage_key text,
  original_name text not null,
  display_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  description text,
  status text not null default 'pending'
    check (status in (
      'pending',
      'uploading',
      'verifying',
      'completed',
      'failed',
      'deleting',
      'deleted'
    )),
  visibility text not null default 'channel'
    check (visibility in ('uploader', 'channel', 'guild')),
  discord_message_id text,
  checksum text,
  completed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index files_guild_id_idx on public.files(guild_id);
create index files_channel_id_idx on public.files(channel_id);
create index files_uploader_id_idx on public.files(uploader_id);
create index files_status_idx on public.files(status);
create index files_created_at_idx on public.files(created_at desc);

create table public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid references public.files(id) on delete set null,
  requester_id uuid not null references public.users(id),
  guild_id uuid not null references public.guilds(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  token_hash text not null unique,
  provider_session_id text,
  status text not null default 'created'
    check (status in (
      'created',
      'uploading',
      'completed',
      'expired',
      'cancelled',
      'failed'
    )),
  visibility text not null default 'channel'
    check (visibility in ('uploader', 'channel', 'guild')),
  description text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  completed_at timestamptz
);

create index upload_sessions_file_id_idx
  on public.upload_sessions(file_id);

create index upload_sessions_requester_id_idx
  on public.upload_sessions(requester_id);

create index upload_sessions_guild_channel_idx
  on public.upload_sessions(guild_id, channel_id);

create index upload_sessions_expires_at_idx
  on public.upload_sessions(expires_at);

create table public.guild_settings (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null unique references public.guilds(id) on delete cascade,
  max_file_size_bytes bigint not null default 2147483648,
  max_total_size_bytes bigint not null default 10737418240,
  allowed_mime_types text[] not null default array[
    'video/mp4',
    'video/webm',
    'image/png',
    'image/jpeg',
    'application/pdf',
    'application/zip'
  ],
  retention_days integer,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id),
  file_id uuid references public.files(id),
  guild_id uuid references public.guilds(id),
  action text not null,
  details jsonb not null default '{}'::jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index audit_logs_file_id_idx on public.audit_logs(file_id);
create index audit_logs_guild_id_idx on public.audit_logs(guild_id);
create index audit_logs_created_at_idx on public.audit_logs(created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create trigger guilds_set_updated_at
  before update on public.guilds
  for each row execute function public.set_updated_at();

create trigger channels_set_updated_at
  before update on public.channels
  for each row execute function public.set_updated_at();

create trigger files_set_updated_at
  before update on public.files
  for each row execute function public.set_updated_at();

create trigger guild_settings_set_updated_at
  before update on public.guild_settings
  for each row execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.guilds enable row level security;
alter table public.channels enable row level security;
alter table public.files enable row level security;
alter table public.upload_sessions enable row level security;
alter table public.guild_settings enable row level security;
alter table public.audit_logs enable row level security;
