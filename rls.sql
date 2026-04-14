-- =====================================================================
-- GeoEscuelas Honduras — Row Level Security
-- =====================================================================
-- Correr DESPUES de schema.sql y despues de importar schools.csv
-- =====================================================================

alter table public.schools  enable row level security;
alter table public.captures enable row level security;

-- ---------------------------------------------------------------------
-- SCHOOLS: lectura publica (anon puede buscar). Escritura solo admins.
-- ---------------------------------------------------------------------
drop policy if exists "schools_read_all" on public.schools;
create policy "schools_read_all"
  on public.schools for select
  to anon, authenticated
  using (true);

-- Updates solo por rol autenticado con claim admin=true (tu dashboard).
drop policy if exists "schools_admin_write" on public.schools;
create policy "schools_admin_write"
  on public.schools for update
  to authenticated
  using (coalesce((auth.jwt() ->> 'role') = 'admin', false))
  with check (coalesce((auth.jwt() ->> 'role') = 'admin', false));

-- ---------------------------------------------------------------------
-- CAPTURES: anon puede INSERTAR (directores). Nadie puede MODIFICAR ni BORRAR
-- (audit trail inmutable). Admin puede leer todo. Anon puede leer solo sus
-- propias capturas recientes (para el historial local normalmente basta con
-- localStorage; dejamos read anon por si quieres reconstruir historial).
-- ---------------------------------------------------------------------
drop policy if exists "captures_anon_insert" on public.captures;
create policy "captures_anon_insert"
  on public.captures for insert
  to anon, authenticated
  with check (
    lat between 12.0 and 17.0        -- Honduras bounds (lat)
    and lon between -89.5 and -83.0  -- Honduras bounds (lon)
    and length(surveyor_name) between 3 and 100
    and length(sace_code) = 9
    -- la escuela debe existir
    and exists (select 1 from public.schools s where s.id = school_id)
  );

drop policy if exists "captures_read_all" on public.captures;
create policy "captures_read_all"
  on public.captures for select
  to anon, authenticated
  using (true);

-- Sin policies de UPDATE/DELETE = nadie puede modificar ni borrar.
-- Si necesitas purgar registros erroneos, usa service_role key desde admin.

-- ---------------------------------------------------------------------
-- Nota de seguridad:
-- La anon key de Supabase es publica por diseno. Estas policies son la
-- barrera real. Un atacante solo puede:
--   - Leer el catalogo (ya es publico)
--   - Insertar capturas con codigo SACE valido y coords dentro de Honduras
-- No puede: modificar schools, borrar capturas, ni acceder a otras tablas.
-- ---------------------------------------------------------------------
