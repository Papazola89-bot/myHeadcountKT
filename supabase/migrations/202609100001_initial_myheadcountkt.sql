create extension if not exists pgcrypto;

create table if not exists public.schools (
  school_id text primary key,
  kod_sekolah text not null unique,
  nama_sekolah text not null,
  zon text not null default '',
  status text not null default 'Aktif',
  access_code_hash text,
  access_code_salt text,
  access_code_last4 text,
  access_code_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_users (
  user_id text primary key,
  google_sub text unique,
  email text not null unique,
  nama text not null,
  role text not null check (role in ('ADMIN','GURU')),
  school_id text references public.schools(school_id) on update cascade,
  status text not null default 'Aktif',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.students (
  student_id text primary key,
  school_id text not null references public.schools(school_id) on update cascade,
  nama text not null,
  tahun integer not null check (tahun between 2 and 6),
  kelas text not null,
  tarikh_mula date,
  subject text not null check (subject in ('Bahasa Melayu','Matematik')),
  status text not null default 'Aktif',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, nama, tahun, kelas, subject)
);

create table if not exists public.assessments (
  assessment_id text primary key,
  student_id text not null references public.students(student_id) on delete cascade,
  subject text not null check (subject in ('Bahasa Melayu','Matematik')),
  tahun_data integer not null,
  cycle text not null,
  skill_code text not null,
  tarikh timestamptz not null default now(),
  teacher_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, subject, tahun_data, cycle)
);

create table if not exists public.targets (
  student_id text primary key references public.students(student_id) on delete cascade,
  "OTI1" text not null,
  "OTI2" text not null,
  "OTI3" text not null,
  "ETR" text not null,
  manual_override boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.intervention_groups (
  group_id text primary key,
  school_id text not null references public.schools(school_id) on delete cascade,
  group_name text not null,
  skill_code text not null,
  skill_name text not null default '',
  student_ids jsonb not null default '[]'::jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.interventions (
  intervention_id text primary key,
  student_id text not null references public.students(student_id) on delete cascade,
  skill_code text not null,
  isu text not null,
  intervensi text not null,
  kaedah text not null,
  tarikh_mula date not null,
  tarikh_semakan date not null,
  evidens text not null default '',
  outcome text not null default '',
  status text not null default 'Sedang dilaksanakan',
  teacher_id text not null,
  group_id text references public.intervention_groups(group_id) on delete set null,
  batch_id text,
  request_id uuid,
  catatan text not null default '',
  skill_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists interventions_request_student_unique
  on public.interventions(request_id, student_id) where request_id is not null;

create table if not exists public.submissions (
  school_id text not null references public.schools(school_id) on delete cascade,
  tahun integer not null,
  subject text not null check (subject in ('Bahasa Melayu','Matematik')),
  cycle text not null,
  status text not null default 'Belum mula',
  submitted_at timestamptz,
  verified_at timestamptz,
  verified_by text,
  primary key (school_id, tahun, subject, cycle)
);

create table if not exists public.transfers (
  transfer_id text primary key,
  student_id text not null references public.students(student_id) on delete cascade,
  from_school_id text not null references public.schools(school_id),
  to_school_id text references public.schools(school_id),
  transfer_type text not null check (transfer_type in ('DALAM_DAERAH','LUAR_DAERAH')),
  status text not null,
  requested_at timestamptz not null default now(),
  requested_by text not null,
  imported_at timestamptz,
  imported_by text
);

create table if not exists public.master_skills (
  subject text not null check (subject in ('Bahasa Melayu','Matematik')),
  skill_code text not null,
  nama_kemahiran text not null,
  kategori text not null default '',
  turutan integer not null,
  primary key (subject, skill_code)
);

create table if not exists public.audit_logs (
  audit_id bigint generated always as identity primary key,
  timestamp timestamptz not null default now(),
  user_id text not null,
  role text not null,
  school_id text,
  tindakan text not null,
  data_lama jsonb,
  data_baharu jsonb
);

create table if not exists public.school_sessions (
  token_hash text primary key,
  school_id text not null references public.schools(school_id) on delete cascade,
  school_code text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.login_attempts (
  code_hash text primary key,
  failures integer not null default 0,
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists students_school_idx on public.students(school_id);
create index if not exists app_users_school_idx on public.app_users(school_id);
create index if not exists assessments_student_idx on public.assessments(student_id);
create index if not exists interventions_student_idx on public.interventions(student_id);
create index if not exists interventions_group_idx on public.interventions(group_id);
create index if not exists intervention_groups_school_idx on public.intervention_groups(school_id);
create index if not exists school_sessions_school_idx on public.school_sessions(school_id);
create index if not exists transfers_destination_idx on public.transfers(to_school_id, status);
create index if not exists transfers_from_school_idx on public.transfers(from_school_id);
create index if not exists transfers_student_idx on public.transfers(student_id);
create index if not exists submissions_school_idx on public.submissions(school_id);
create index if not exists audit_logs_school_idx on public.audit_logs(school_id, timestamp desc);
create index if not exists school_sessions_expiry_idx on public.school_sessions(expires_at);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'schools','app_users','students','assessments','targets','intervention_groups',
    'interventions','submissions','transfers','master_skills','audit_logs',
    'school_sessions','login_attempts'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end $$;

grant usage, select on all sequences in schema public to service_role;

insert into public.app_users (user_id, email, nama, role, school_id, status)
values ('ADMIN-OWNER', 'geek2606@gmail.com', 'NURRULAZWAN BIN AHMAD', 'ADMIN', null, 'Aktif')
on conflict (email) do update set role='ADMIN', school_id=null, status='Aktif';

insert into public.master_skills (subject, skill_code, nama_kemahiran, kategori, turutan)
select subject, 'KP' || n, 'Kemahiran Pemulihan KP' || n,
  case when n <= 5 then 'Asas' when n <= 12 then 'Permulaan' when n <= 19 then 'Pertengahan' when n <= 27 then 'Lanjutan' else 'Penguasaan' end,
  n
from unnest(array['Bahasa Melayu','Matematik']) subject
cross join generate_series(1,32) n
on conflict (subject, skill_code) do nothing;
