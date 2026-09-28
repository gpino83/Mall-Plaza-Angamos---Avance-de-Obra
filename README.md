# Control de Avance de Obra — INARCO

Sistema web para registrar avance semanal de obra (metrado + P.U.) contra la línea base
valorizada del cronograma contractual, con curva S **física** (ejecución) y **económica**
(valorización S/) por separado, y desface por frente. Contraparte del planner: mide
"la temperatura de la obra" en campo.

## Estructura

```
control-avance-obra/
├── index.html          Login / registro
├── app.html             App principal (Dashboard, Registrar Avance, Partidas)
├── css/style.css
├── js/
│   ├── supabase-config.js   <- AQUÍ VAN TUS CLAVES DE SUPABASE
│   └── app.js
└── sql/
    ├── schema.sql        Ejecutar primero en Supabase (crea tablas y seguridad)
    └── seed_partidas.sql Ejecutar después (carga las ~1011 partidas valorizadas)
```

## Puesta en marcha (una sola vez)

### 1. Supabase — base de datos

1. Crea el proyecto en [supabase.com](https://supabase.com) (sign in con GitHub).
2. Ve a **SQL Editor** → *New query* → pega el contenido completo de `sql/schema.sql` → **Run**.
3. Pega el contenido de `sql/seed_partidas.sql` → **Run** (el archivo es grande —
   ~1011 partidas, ~400 KB de texto — el editor puede tardar unos segundos en pegar y
   correr, es normal). Esto carga la **línea base
   valorizada real**: 1011 partidas extraídas del itemizado de presupuesto
   (`ITEMIZADO_PAQ.1_REV3_INARCO`), cada una con su metrado, precio unitario (P.U.) y
   presupuesto (S/), agrupadas por frente = *Edificio Nuevo / Reforzamiento* × especialidad
   (Estructuras, Arquitectura, IIEE, IISS, ACI, HVAC, Obras Previas, Obras Preliminares).

   ⚠️ **Importante sobre las fechas base**: el presupuesto no trae fecha de inicio/fin por
   partida — esas ~1011 partidas se aproximaron con la fecha del frente físico más cercano
   del cronograma (ej. todo lo de "Reforzamiento — Estructuras" usa el rango de fechas del
   Sector 2 y 3 del cronograma; "Edificio Nuevo — X" usa el rango del Sector 1; Obras
   Previas/Preliminares usan el rango corto inicial). Es un punto de partida razonable, pero
   puedes afinar fechas por partida (o por lotes, editando el SQL) más adelante si quieres
   mayor precisión en la curva.
4. Ve a **Settings → API** y copia:
   - `Project URL`
   - `anon public` key
5. Pégalas en `js/supabase-config.js` (reemplaza los dos placeholders).

### 2. Primer usuario administrador

1. Abre la app (`index.html`) y regístrate con tu correo — quedarás como rol `residente` por defecto.
2. En Supabase → SQL Editor, ejecuta (cambia el correo):
   ```sql
   update perfiles set rol = 'admin' where id = (select id from auth.users where email = 'TU_CORREO@gmail.com');
   ```
3. Desde ahí puedes invitar/crear al resto de usuarios (residentes, planner) — cada uno se
   registra con su correo desde la pantalla de login. Para cambiar el rol de alguien más,
   repite el `update` de arriba con su correo.

### 3. Publicar en GitHub Pages

1. Sube esta carpeta completa a un repositorio en GitHub.
2. Ve a **Settings → Pages** del repo → Source: `main` branch, carpeta `/ (root)` → Save.
3. En 1-2 minutos tu app queda disponible en `https://<usuario>.github.io/<repo>/`.

## Roles

| Rol        | Puede ver | Puede registrar avance | Puede editar metrado/P.U. |
|------------|-----------|------------------------|-----------------------------------|
| `viewer`   | ✅        | ❌                      | ❌                                 |
| `residente`| ✅        | ✅ (el suyo)            | ❌                                 |
| `planner`  | ✅        | ✅                      | ✅                                 |
| `admin`    | ✅        | ✅                      | ✅ (+ gestión de usuarios en Supabase) |

## Cómo funcionan las dos curvas S

Cada partida tiene: metrado total, unidad, precio unitario (P.U.) y presupuesto
(= metrado × P.U.), más fecha inicio/fin de línea base. Cada semana, un responsable
carga el **metrado ejecutado** de la semana para la partida que le corresponde.

- **Avance planificado** de una partida en una fecha = interpolación lineal entre su
  inicio y fin base (0% al inicio, 100% al fin).
- **Avance real** de una partida = metrado ejecutado acumulado ÷ metrado total.

Con eso se arman dos curvas independientes:

1. **Curva Económica (S/)** — pondera cada partida por su participación en el
   presupuesto total. Es la valorización real de obra: cuántos soles del contrato se
   han ejecutado. Es la que importa para facturación / flujo de caja.
2. **Curva Física / Ejecución (%)** — promedio simple entre todas las partidas, sin
   ponderar por costo. Mide cuánta obra se está moviendo en el terreno, independiente
   de si son partidas caras o baratas. Puede divergir de la curva económica: por
   ejemplo, si avanzan muchas partidas pequeñas pero las grandes (estructuras) están
   atrasadas, la física se ve bien pero la económica mal — esa divergencia es
   justamente la señal de alerta temprana ("temperatura de la obra").

El **desface** en ambos casos = avance real − avance planificado. Negativo = atraso.

## Próximos pasos sugeridos

- Afinar las fechas base por partida (hoy aproximadas por frente físico) si se
  necesita mayor precisión en la curva.
- Agregar más proyectos (tabla `proyectos`) a medida que arrancan nuevas obras.
- Exportar la curva S / tabla de desface a PDF o Excel para el reporte semanal al cliente.
- Convertir en PWA para instalar en celulares de los residentes en campo.
