create extension if not exists pgcrypto;

create table if not exists public.stat_reports (
  id uuid primary key default gen_random_uuid(),
  course_key text not null,
  course_id text not null,
  course_title text not null,
  instructor text not null,
  department text not null,
  year integer not null,
  semester integer not null,
  assessment_label text not null default '기타',
  nickname varchar(10) not null default '(익명)',
  q0 numeric,
  q1 numeric,
  q2 numeric,
  q3 numeric,
  q4 numeric,
  average numeric,
  max_score numeric,
  note text,
  source text not null default 'direct',
  reporter_email_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.stat_reports add column if not exists course_key text;
alter table public.stat_reports add column if not exists assessment_label text not null default '기타';
alter table public.stat_reports add column if not exists nickname varchar(10) not null default '(익명)';
alter table public.stat_reports add column if not exists q0 numeric;
alter table public.stat_reports add column if not exists q2 numeric;
alter table public.stat_reports add column if not exists q4 numeric;
alter table public.stat_reports add column if not exists updated_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stat_reports'
      and column_name = 'median'
  ) then
    execute 'update public.stat_reports set q2 = median where q2 is null and median is not null';
  end if;
end $$;

create index if not exists stat_reports_course_key_idx
  on public.stat_reports (course_key, year desc, semester desc, created_at desc);

create table if not exists public.quick_reports (
  id uuid primary key default gen_random_uuid(),
  course_key text not null,
  course_id text not null,
  course_title text not null,
  instructor text not null,
  department text not null,
  year integer not null,
  semester integer not null,
  assessment_label text not null default '기타',
  nickname varchar(10) not null default '(익명)',
  file_path text not null,
  file_name text not null,
  content_type text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  reporter_email_hash text not null,
  reviewed_by_hash text,
  linked_stat_id uuid references public.stat_reports(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.quick_reports add column if not exists course_key text;
alter table public.quick_reports add column if not exists assessment_label text not null default '기타';
alter table public.quick_reports add column if not exists nickname varchar(10) not null default '(익명)';

create index if not exists quick_reports_status_idx
  on public.quick_reports (status, created_at desc);

create index if not exists quick_reports_course_key_idx
  on public.quick_reports (course_key, status, created_at desc);

create table if not exists public.course_favorites (
  id uuid primary key default gen_random_uuid(),
  user_email_hash text not null,
  course_key text not null,
  course_id text not null,
  course_title text not null,
  instructor text not null,
  department text not null,
  created_at timestamptz not null default now(),
  unique (user_email_hash, course_key)
);

create index if not exists course_favorites_user_idx
  on public.course_favorites (user_email_hash, created_at desc);

create table if not exists public.difficulty_polls (
  id uuid primary key default gen_random_uuid(),
  course_key text not null,
  course_id text not null,
  course_title text not null,
  instructor text not null,
  department text not null,
  year integer not null,
  semester integer not null,
  assessment_label text not null default '기타',
  opened_by_hash text not null,
  opened_at timestamptz not null default now(),
  closes_at timestamptz not null
);

alter table public.difficulty_polls add column if not exists course_key text;
alter table public.difficulty_polls add column if not exists assessment_label text not null default '기타';

create index if not exists difficulty_polls_course_key_idx
  on public.difficulty_polls (course_key, closes_at desc);

create index if not exists difficulty_polls_assessment_idx
  on public.difficulty_polls (course_key, assessment_label, closes_at desc);

create table if not exists public.difficulty_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.difficulty_polls(id) on delete cascade,
  course_key text not null,
  course_id text not null,
  assessment_label text not null default '기타',
  year integer not null default extract(year from now())::integer,
  semester integer not null default 1,
  voter_email_hash text not null,
  rating smallint not null check (rating between 1 and 5),
  difficulty_tags text not null default '',
  created_at timestamptz not null default now(),
  unique (poll_id, voter_email_hash)
);

alter table public.difficulty_votes add column if not exists course_key text;
alter table public.difficulty_votes add column if not exists difficulty_tags text not null default '';
alter table public.difficulty_votes add column if not exists assessment_label text not null default '기타';
alter table public.difficulty_votes add column if not exists year integer not null default extract(year from now())::integer;
alter table public.difficulty_votes add column if not exists semester integer not null default 1;

create index if not exists difficulty_votes_monthly_idx
  on public.difficulty_votes (voter_email_hash, created_at desc);

create index if not exists difficulty_votes_assessment_idx
  on public.difficulty_votes (course_key, assessment_label, created_at asc);

create table if not exists public.course_comments (
  id uuid primary key default gen_random_uuid(),
  course_key text not null,
  course_id text not null,
  course_title text not null,
  instructor text not null,
  department text not null,
  display_name text not null,
  body varchar(50) not null,
  author_email_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists course_comments_course_key_idx
  on public.course_comments (course_key, created_at desc);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  google_name text not null default '',
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_created_at_idx
  on public.activity_logs (created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quick-reports',
  'quick-reports',
  false,
  3145728,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.stat_reports enable row level security;
alter table public.quick_reports enable row level security;
alter table public.course_favorites enable row level security;
alter table public.difficulty_polls enable row level security;
alter table public.difficulty_votes enable row level security;
alter table public.course_comments enable row level security;
alter table public.activity_logs enable row level security;
