-- =====================================================================
-- GeoEscuelas Honduras — Esquema Supabase v1
-- =====================================================================
-- Correr en Supabase SQL Editor en este orden:
--   1) este archivo (schema.sql)
--   2) Import schools.csv via Supabase UI (Table Editor > schools > Import)
--   3) rls.sql (politicas)
-- =====================================================================

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- TABLE: schools  (catalogo maestro, 23,447 centros SACE 2024)
-- ---------------------------------------------------------------------
create table if not exists public.schools (
  id              uuid primary key default gen_random_uuid(),
  sace_code       text unique not null,
  name            text not null,
  department      text not null,
  municipio       text not null,
  localidad       text,
  zone            text,                    -- URBANO / RURAL
  school_type     text,                    -- CEB, CCEPREB, etc.
  cycle           text,                    -- BASICA I CICLO, etc.
  administration  text,                    -- GUBERNAMENTAL / NO GUBERNAMENTAL
  enrollment_2024 integer default 0,
  -- Coordenadas "oficiales" finales (resultado del proceso). NULL hasta que
  -- un capture valido la consolide.
  geom            geography(Point,4326),
  located_at      timestamptz,
  located_by      uuid,                    -- fk a capture que consolido
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists schools_geom_idx     on public.schools using gist (geom);
create index if not exists schools_dept_idx     on public.schools (department);
create index if not exists schools_municipio_idx on public.schools (municipio);
create index if not exists schools_name_trgm    on public.schools using gin (name gin_trgm_ops);

-- trigram para busqueda por nombre en servidor (opcional; la PWA ya busca local)
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------
-- TABLE: captures  (cada georreferenciacion individual; puede haber N por escuela)
-- ---------------------------------------------------------------------
create table if not exists public.captures (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  sace_code       text not null,           -- redundante, util para queries
  lat             double precision not null,
  lon             double precision not null,
  geom            geography(Point,4326) generated always as (
                    st_setsrid(st_makepoint(lon,lat),4326)::geography
                  ) stored,
  accuracy_m      double precision,        -- precision GPS; null si pin-drop
  altitude_m      double precision,
  method          text not null check (method in ('gps','pin','manual')),
  -- estado que reporta el director
  status          text not null default 'activo'
                  check (status in ('activo','inactivo','cerrado','no_encontrado')),
  observations    text,
  surveyor_name   text not null,
  surveyor_device text,
  client_id       text,                    -- id local del registro (dedup)
  created_at      timestamptz default now()
);

create index if not exists captures_school_idx on public.captures (school_id);
create index if not exists captures_geom_idx   on public.captures using gist (geom);
create unique index if not exists captures_client_id_key
  on public.captures (client_id) where client_id is not null;

-- ---------------------------------------------------------------------
-- VIEW: v_schools_status  (resumen para dashboard)
-- ---------------------------------------------------------------------
create or replace view public.v_schools_status as
select
  s.id, s.sace_code, s.name, s.department, s.municipio, s.localidad,
  s.zone, s.enrollment_2024,
  (s.geom is not null) as is_located,
  (select count(*) from public.captures c where c.school_id = s.id) as capture_count,
  (select max(c.created_at) from public.captures c where c.school_id = s.id) as last_capture_at
from public.schools s;

-- ---------------------------------------------------------------------
-- FUNCTION + TRIGGER: consolida primera captura valida en schools.geom
-- ---------------------------------------------------------------------
create or replace function public.on_capture_upsert_school_geom()
returns trigger language plpgsql as $$
begin
  -- Si la escuela no tiene coordenada aun, usa esta captura como oficial.
  update public.schools s
     set geom       = new.geom,
         located_at = new.created_at,
         located_by = new.id,
         updated_at = now()
   where s.id = new.school_id
     and s.geom is null;
  return new;
end $$;

drop trigger if exists trg_capture_consolidate on public.captures;
create trigger trg_capture_consolidate
  after insert on public.captures
  for each row execute function public.on_capture_upsert_school_geom();

-- ---------------------------------------------------------------------
-- Comentarios
-- ---------------------------------------------------------------------
comment on table public.schools is
  'Catalogo maestro de centros educativos de Honduras (SACE 2024). 23,447 registros.';
comment on table public.captures is
  'Registros individuales de georreferenciacion levantados en campo o via pin satelital.';
comment on column public.captures.method is
  'gps = GPS del dispositivo; pin = pin-drop sobre imagen satelital; manual = lat/lon escrita a mano.';
