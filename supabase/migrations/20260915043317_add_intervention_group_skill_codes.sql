alter table public.intervention_groups
  add column if not exists skill_codes text[] not null default array[]::text[];

update public.intervention_groups
set skill_codes = array[skill_code]
where cardinality(skill_codes) = 0;

alter table public.intervention_groups
  drop constraint if exists intervention_groups_skill_codes_nonempty;

alter table public.intervention_groups
  add constraint intervention_groups_skill_codes_nonempty
  check (cardinality(skill_codes) between 1 and 32);
