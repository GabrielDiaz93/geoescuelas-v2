-- =====================================================================
-- GeoEscuelas Honduras — RLS policies para el Admin Dashboard
-- =====================================================================
-- Agrega permisos de UPDATE/DELETE para el admin identificado por email.
-- Correr UNA sola vez despues de rls.sql.
-- Para agregar mas admins en el futuro: meterlos en la lista de abajo.
-- =====================================================================

-- Tabla auxiliar con los emails admin (mas flexible que hardcodear en policy)
create table if not exists public.admins (
  email text primary key,
  added_at timestamptz default now()
);

insert into public.admins (email) values ('gabriel.diaz@iher.hn')
on conflict (email) do nothing;

-- Helper: esta el usuario autenticado en la lista de admins?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins a
    where a.email = coalesce(auth.jwt() ->> 'email', '')
  );
$$;

-- ---------------------------------------------------------------------
-- SCHOOLS: admin puede UPDATE y DELETE
-- ---------------------------------------------------------------------
drop policy if exists "schools_admin_write" on public.schools;  -- la que venia de rls.sql
drop policy if exists "schools_admin_update" on public.schools;
create policy "schools_admin_update"
  on public.schools for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "schools_admin_delete" on public.schools;
create policy "schools_admin_delete"
  on public.schools for delete
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- CAPTURES: admin puede UPDATE y DELETE (moderar errores)
-- ---------------------------------------------------------------------
drop policy if exists "captures_admin_update" on public.captures;
create policy "captures_admin_update"
  on public.captures for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "captures_admin_delete" on public.captures;
create policy "captures_admin_delete"
  on public.captures for delete
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- Helper: al borrar la ultima captura de una escuela, resetear su geom
-- ---------------------------------------------------------------------
create or replace function public.on_capture_delete_reset_school()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Si la escuela tiene geom que vino de esta captura, y no hay otras capturas,
  -- resetear. Si hay otras, usar la mas antigua.
  update public.schools s
     set geom = coalesce(
           (select c.geom from public.captures c
             where c.school_id = s.id
             order by c.created_at asc limit 1),
           null
         ),
         located_at = (select c.created_at from public.captures c
                        where c.school_id = s.id
                        order by c.created_at asc limit 1),
         located_by = (select c.id from public.captures c
                        where c.school_id = s.id
                        order by c.created_at asc limit 1),
         updated_at = now()
   where s.id = old.school_id;
  return old;
end $$;

drop trigger if exists trg_capture_delete_reset on public.captures;
create trigger trg_capture_delete_reset
  after delete on public.captures
  for each row execute function public.on_capture_delete_reset_school();

-- Verificacion:
-- select public.is_admin(); -- debe dar true cuando estes logueado como admin
-- select count(*) from public.schools; -- debe ver 23447
