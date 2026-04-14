# GeoEscuelas Honduras v2 — Deploy (3 pasos)

Objetivo: reemplazar el backend de GitHub Issues (inseguro, el token estaba
expuesto) por **Supabase** (PostGIS, Row-Level Security). 23,447 centros
SACE 2024 pre-cargados; los directores solo agregan coordenadas.

---

## Antes de nada: revocar token GitHub (2 min)

1. Abra https://github.com/settings/tokens
2. Revoque el token que empieza con `gho_poGx...` (estaba hardcodeado en la PWA v1).
3. Opcional: revise issues recientes del repo `GabrielDiaz93/geoescuelas-honduras`
   por si alguien lo uso.

---

## Paso 1 — Crear proyecto Supabase (2 min)

1. Vaya a https://supabase.com/dashboard, cree cuenta (login con GitHub o Google).
2. **New project**:
   - Name: `geoescuelas-honduras`
   - Database password: generar una segura y guardarla (no se usa para la PWA,
     solo para admin SQL)
   - Region: **East US (North Virginia)** o **Central US** (mas cerca a HN)
   - Plan: **Free**
3. Espere ~2 min mientras aprovisiona.
4. Cuando este listo, vaya a **Project Settings > API** y copie:
   - `Project URL` (ej. `https://xyz.supabase.co`)
   - `anon public` key (empieza con `eyJ...`)

## Paso 2 — Cargar esquema y datos (5 min)

### 2a. Correr el esquema
1. En Supabase, abra **SQL Editor > New query**.
2. Pegue el contenido de `schema.sql` y presione **Run**.
3. Verifique: en **Table Editor** aparecen `schools`, `captures`, y la vista
   `v_schools_status`.

### 2b. Importar 23,447 escuelas
Opcion A (UI — recomendado):
1. **Table Editor > schools > Import data from CSV**.
2. Seleccione `schools.csv` (2.8 MB).
3. Map columns automatico (los nombres coinciden).
4. Import. Tarda ~1 min.

Opcion B (SQL COPY — solo si tiene acceso a la DB directa):
```sql
-- En Database > SQL Editor no funciona COPY FROM local.
-- Usar la UI (Opcion A) o psql directo con el connection string.
```

### 2c. Aplicar Row-Level Security
1. SQL Editor > New query.
2. Pegue `rls.sql` y presione **Run**.
3. Verifique: en **Authentication > Policies** aparecen 4 policies activas.

## Paso 3 — Configurar y publicar la PWA (3 min)

1. Edite `config.js`:
   ```js
   window.__GEO_CFG__ = {
     url: "https://SU_PROYECTO.supabase.co",
     key: "eyJ...SU_ANON_KEY..."
   };
   ```
2. Subir la carpeta `geoescuelas_v2/` a donde tenga hosting estatico:
   - **GitHub Pages** (facil): commit a un repo `geoescuelas-v2` y activar Pages
   - **Cloudflare Pages** (mejor, mas rapido): drag&drop la carpeta en
     https://pages.cloudflare.com
   - **Netlify** (tambien drag&drop): https://app.netlify.com/drop
3. Generar QR apuntando a la URL del hosting (usar
   `https://api.qrserver.com/v1/create-qr-code/?data=LA_URL&size=600x600` o
   cualquier generador).
4. Distribuir QR + instrucciones a directores / coordinadores departamentales.

---

## Verificacion (smoke test)

Con la PWA abierta en el celular:
- [ ] Carga los 23,447 centros (barra de progreso desaparece)
- [ ] Busqueda encuentra una escuela por nombre
- [ ] Toggle GPS / Pin funciona
- [ ] GPS fija senal al aire libre
- [ ] Pin satelital permite arrastrar marcador
- [ ] Guardar crea fila en Supabase (verifica en **Table Editor > captures**)
- [ ] Trigger actualiza `schools.geom` automaticamente
- [ ] Funciona offline (airplane mode -> guardar -> reconectar -> sync)

## Dashboard (opcional, fase 2)

El esquema incluye la vista `v_schools_status` con:
- `is_located` (bool): si ya tiene coord
- `capture_count`: cuantas capturas ha recibido
- `last_capture_at`: cuando fue la ultima

Para el mapa que le muestras al presidente, simplest: exportar `schools` con
`geom` a GeoJSON via PostGIS:
```sql
select jsonb_build_object(
  'type','FeatureCollection',
  'features', jsonb_agg(jsonb_build_object(
    'type','Feature',
    'geometry', st_asgeojson(geom)::jsonb,
    'properties', jsonb_build_object(
      'sace_code',sace_code,'name',name,'department',department,
      'municipio',municipio,'enrollment',enrollment_2024
    )
  ))
) from schools where geom is not null;
```

---

## Troubleshooting

- **"Falta configurar Supabase"** al abrir la PWA: no editaste `config.js` o
  dejaste los placeholders.
- **Captures no se insertan**: revisar que `schools.csv` se importo (debe haber
  23,447 filas en `schools`), que RLS policies estan activas, y que el
  `sace_code` del registro existe en la tabla `schools`.
- **Pin-drop mapa vacio**: la capa Esri requiere internet. Usar modo GPS si no
  hay conectividad.
- **Exceso de `captures`**: multiples directores re-georreferenciando la misma
  escuela. Normal. La primera valida consolida; las siguientes quedan como
  audit trail. Puedes ignorar o dedupear en dashboard.

## Archivos del paquete

```
geoescuelas_v2/
  index.html         PWA UI
  app.js             Logica cliente
  config.js          <-- EDITAR con tus keys Supabase
  sw.js              Service Worker (offline)
  manifest.json      PWA manifest
  icon-192.png       Icono
  icon-512.png       Icono
  centros.json       Catalogo 23,447 centros (para buscador)
  schools.csv        Mismo catalogo para importar a Supabase
  schema.sql         DDL Postgres/PostGIS
  rls.sql            Row Level Security policies
  seed_schools.py    Regenera centros.json + schools.csv desde Excel SACE
  DEPLOY.md          Este archivo
```
