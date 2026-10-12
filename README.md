# Dietética: catálogo y e-commerce liviano

Catálogo de ~1.000 artículos con búsqueda instantánea, filtros dietarios, variantes por peso,
carrito persistente y cierre de pedido por **WhatsApp** o **Mercado Pago**.

```
backend/   FastAPI + SQLAlchemy 2 (SQLite → PostgreSQL)   · 26 tests
frontend/  Next.js 15 (App Router) + Tailwind 4 + Lucide   · 3 tests + typecheck
```

## Arranque rápido

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m scripts.import_csv data/plantilla_productos.csv     # carga de ejemplo
export WHATSAPP_NUMBER=5491112345678 ADMIN_TOKEN=algo-largo
uvicorn app.main:app --reload                                 # http://localhost:8000/docs

# Frontend
cd frontend
cp .env.example .env.local && npm install
npm run dev                                                   # http://localhost:3000
```

Tests: `cd backend && pytest -q` · `cd frontend && npm test && npm run typecheck`

## Panel de gestión (`/admin`)

```bash
cd backend
python -m scripts.create_admin        # crea tu usuario (pide usuario y contraseña)
```

Después entrá a http://localhost:3000/admin. Secciones:

| Sección | Qué hace |
|---|---|
| **Resumen** | ventas de hoy y del período (7/30/90 días), gráfico diario, más vendidos, stock bajo, pedidos pendientes |
| **Pedidos** | pestañas por estado, búsqueda, detalle y cambio de estado. El stock se descuenta al marcar *pagado* o *entregado* (una sola vez) y se devuelve al *cancelar* |
| **Productos** | precio y stock editables directo en la tabla, ocultar/mostrar, alta y edición con presentaciones y etiquetas |
| **Importar** | sube Excel/CSV, muestra una vista previa con errores por fila y recién guarda al confirmar |

Inicio de sesión: ver/ocultar contraseña, aviso de Bloq Mayús, "Mantener la sesión iniciada"
(30 días; si se desmarca, la sesión se cierra al cerrar el navegador y dura como máximo 12 h) y
aviso cuando el servidor gratis de Render está despertando. En **Mi cuenta** se cambia la
contraseña (cierra la sesión en los otros dispositivos) y se puede cerrar la sesión en todos lados.

**¿Te olvidaste la contraseña?** En Render → `dietetica-api` → Environment cambiá `ADMIN_PASSWORD`
y redeployá: al arrancar, si la variable cambió, se restablece la contraseña de `ADMIN_USER` y se
cierran todas las sesiones. Si la variable no cambia, se respeta la clave elegida en el panel.

Seguridad: contraseña con scrypt, sesión en cookie HttpOnly guardada en la base (cerrar sesión
la invalida), límite de intentos de login. El frontend reenvía `/api/*` al backend (ver
`next.config.ts`), así la cookie queda en el mismo dominio. En producción con HTTPS poné
`COOKIE_SECURE=true`. Variables: `ADMIN_USER`/`ADMIN_PASSWORD`, `SESSION_DAYS` (30),
`SESSION_HOURS_SHORT` (12), `LOW_STOCK` (umbral de stock bajo, 5 por defecto).

## Publicar en Render

El archivo `render.yaml` (Blueprint) crea todo de una vez: base PostgreSQL, backend y tienda.

1. **Subí el proyecto a GitHub** (repositorio privado está bien). Sin instalar nada: en github.com
   creá un repositorio nuevo → *uploading an existing file* → arrastrá el contenido de esta carpeta
   (sin `node_modules`, `.next`, `.env.local` ni archivos `.db`).
2. En [dashboard.render.com](https://dashboard.render.com): **New → Blueprint** → elegí el repositorio.
3. Completá lo que pide:
   - `ADMIN_PASSWORD`: la contraseña del panel (usuario `admin`), mínimo 8 caracteres.
   - `WHATSAPP_NUMBER` y `NEXT_PUBLIC_WHATSAPP_NUMBER`: el mismo número, ej. `5491112345678`.
   - `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET`: dejalos vacíos si todavía no usás Mercado Pago.
4. **Apply**. El primer deploy tarda 5–10 minutos.
5. Entrá a `https://dietetica-web.onrender.com/admin` → **Importar** → subí tu planilla.

Notas:
- La tienda llama a `/api/*` en su propio dominio y Next lo reenvía al backend (`API_HOST`):
  sin CORS y con la cookie del panel `Secure` + `HttpOnly`.
- El catálogo se cachea 60 s; cada cambio desde el panel lo refresca al instante (`/revalidate-catalog`).
- **Plan gratis:** los servicios se duermen tras 15 min sin visitas (la primera carga tarda ~1 min)
  y la base gratis vence a los 30 días. Para la tienda real: servicios `starter` y base `basic-256mb`
  (cambiá `plan:` en `render.yaml`).
- Mercado Pago: en su panel configurá el webhook `https://dietetica-api.onrender.com/api/payments/mercadopago/webhook`.
- Probado con PostgreSQL 16 (`TEST_DATABASE_URL=postgresql://… pytest`).

## Arquitectura

```
Navegador ──(1 descarga, ETag, gzip)──► GET /api/catalog
   │  índice en memoria → cada tecla filtra en 1-3 ms (sin red)
   │  carrito en LocalStorage
   └─► POST /api/orders ──► precios recalculados en el servidor
                         ├─ whatsapp     → wa.me/<nro>?text=...
                         └─ mercadopago  → preferencia Checkout Pro → init_point
Mercado Pago ──► POST /api/payments/mercadopago/webhook (firma HMAC + GET /v1/payments/{id})
Admin ──► POST /api/admin/import (CSV/XLSX, upsert por SKU, sync, dry-run)
```

* **Búsqueda en el cliente:** 1.000 productos compactos pesan ~150-250 KB (unos 30 KB con gzip).
  Se descargan una vez y el filtrado es instantáneo, sin carga en el servidor. El backend usa el
  mismo algoritmo (`/api/products?q=`, `/api/search/suggest`) para SEO, apps o catálogos más grandes.
* **Catálogo en memoria en el backend:** read-model que se recarga cuando cambia
  `catalog_meta.version` (el importador la incrementa), así funciona con varios workers.
* **Dinero en centavos (int)** en toda la pila: sin errores de redondeo.
* **Nunca se confía en el carrito:** el servidor recalcula precios, valida stock y genera el código del pedido.

## 1. Esquema de base de datos (`backend/app/models.py`)

```
categories   (id, name, slug UQ, parent_id → categories, sort_order)       -- jerárquica
tags         (id, slug UQ, name, kind[dietary|general], sort_order)
products     (id, slug UQ, name, brand, description, image_url, synonyms,
              search_text, is_active, category_id → categories, timestamps)
product_tags (product_id, tag_id)                                            -- N:M
variants     (id, product_id → products, sku UQ, label, sale_type[peso|unidad],
              quantity, unit[g|ml|u], price, compare_at_price, stock NULL=sin control,
              is_active, sort_order)
orders       (id, code UQ, status, channel, customer_*, delivery_method, address,
              notes, total, mp_preference_id, mp_payment_id, timestamps)
order_items  (id, order_id, variant_id, sku, product_name*, variant_label*, unit_price*,
              quantity, subtotal)                                            -- * snapshot
catalog_meta (id=1, version)
```

Para producción conviene sumar Alembic para las migraciones.

## 2. Importar listas de precios

Desde **/admin → Importar** se sube la lista **tal como esté**: Excel (`.xlsx`, `.xls`), CSV o el PDF
del proveedor. No hace falta usar la plantilla (`backend/app/services/sheet_reader.py`):

* Busca la fila de encabezados aunque arriba haya logo, título o fecha.
* Reconoce columnas con otros nombres: *Descripción / Artículo* → nombre, *P. Venta / Precio público*
  → precio (ignora *Costo*, *Mayorista*, *Sin IVA*), *Rubro / Familia* → categoría, *Cód.* → SKU, etc.
* Filas de sección (`FRUTOS SECOS` sin precio) y hojas del Excel se usan como categoría.
* Del nombre saca la presentación (`Almendras x 500 grs` → producto *Almendras*, 500 g; las
  presentaciones del mismo producto se agrupan) y etiquetas (*sin TACC, vegano, orgánico, keto, sin azúcar*).
  `Precio x kg` o *granel* → venta por peso.
* Sin códigos: genera uno estable por nombre + presentación, así la próxima lista actualiza precios
  en vez de duplicar. Si el proveedor cambia el código, se reconoce la misma presentación.
* Lo que la lista no trae (stock, marca, rubro, etiquetas) se conserva como estaba.
* La vista previa muestra cómo entendió cada columna y los primeros productos; si algo quedó mal se
  cambia la columna y se vuelve a revisar. Nada se guarda hasta confirmar.

### Plantilla (opcional)

Archivo: `backend/data/plantilla_productos.csv` (separador `;`, también acepta `,` y `.xlsx`).
**Una fila por variante (SKU)**: las filas con el mismo `producto` forman un solo producto.

| Columna | Oblig. | Ejemplo | Notas |
|---|---|---|---|
| sku | ✔ | ALM-500 | clave de upsert |
| producto | | almendras-peladas | agrupa variantes; si falta se usa nombre+marca |
| nombre | ✔ | Almendras peladas | |
| marca | | Dicomere | también se busca por marca |
| categoria | ✔ | Harinas | categoría madre |
| subcategoria | | Harinas sin TACC | |
| variante | | 500 g / Frasco 380 g | si falta se deriva de `contenido` |
| tipo_venta | | peso \| unidad | |
| contenido | | 500g, 1kg, 200ml, 1 u | para precio por kg/L |
| precio | ✔ | 8.100 / $ 1.234,50 | formato AR o internacional |
| precio_lista | | 9.000 | precio tachado (oferta) |
| stock | | 25 | vacío = no controla stock |
| etiquetas | | sin tacc\|vegano\|keto | alias: sin gluten, gluten free, organic… |
| sinonimos | | chia\|chía\|salvia hispanica | mejora la búsqueda |
| descripcion, imagen_url, activo (si/no), orden | | | |

```bash
python -m scripts.import_csv inventario.xlsx --dry-run   # solo valida
python -m scripts.import_csv inventario.xlsx --sync      # upsert + desactiva SKUs ausentes
curl -H "X-Admin-Token: $ADMIN_TOKEN" -F file=@inventario.csv \
     "http://localhost:8000/api/admin/import?sync=true"
```

Medido: 2.000 filas (1.000 productos) se importan en ~0,6 s; cada búsqueda en el servidor tarda ~5 ms.

## 3. API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/catalog` | catálogo completo compacto (ETag / 304) |
| GET | `/api/products?q=&category=&tags=sin-tacc,vegano&brand=&sort=&page=&page_size=` | listado paginado + facetas |
| GET | `/api/products/{slug}` | detalle |
| GET | `/api/search/suggest?q=` | autocompletado |
| GET | `/api/categories`, `/api/tags` | maestros |
| POST | `/api/orders` | `{channel, customer, items:[{sku, quantity}]}` → `whatsapp_url` o `checkout_url` |
| GET | `/api/orders/{code}` | estado del pedido |
| POST | `/api/payments/mercadopago/webhook` | confirmación de pago |
| POST | `/api/admin/login` · `/logout` · GET `/me` | sesión del panel |
| GET/POST/PUT | `/api/admin/products[/{id}]` · PATCH `/variants/{sku}` | gestión de productos |
| GET/PATCH | `/api/admin/orders[/{code}]` | pedidos y cambio de estado |
| GET | `/api/admin/stats?days=30` | resumen de ventas |
| POST | `/api/admin/import?sync=&dry_run=&strict=` | carga masiva |

Documentación interactiva en `http://localhost:8000/docs`.

## 4-5. Frontend y WhatsApp

* `frontend/components/CatalogSearch.tsx`: buscador + chips dietarios + categorías + grilla.
* `frontend/components/ProductCard.tsx`: selector 250 g / 500 g / 1 kg y precio por kg.
* `frontend/components/CartDrawer.tsx`: carrito + checkout por WhatsApp o Mercado Pago.
* `frontend/lib/search.ts`: motor difuso (tildes, typos, sinónimos, facetas).
* `frontend/lib/cart.ts`: carrito en LocalStorage (`useSyncExternalStore`, sincronizado entre pestañas).
* `frontend/lib/whatsapp.ts`: `buildWhatsAppMessage()` / `buildWhatsAppUrl()`.

Mensaje generado:

```
🛒 *Nuevo pedido — Dietética*
Pedido: *D-27KCAS*

• 2 × Almendras peladas (500 g)
   $ 8.100 c/u → *$ 16.200*
• 1 × Semillas de chía (250 g)
   $ 1.800 c/u → *$ 1.800*

Artículos: 3
*TOTAL: $ 18.000*

👤 Ana
🏪 Retiro en el local
```

## Variables de entorno (backend)

`DATABASE_URL`, `ADMIN_USER`, `ADMIN_PASSWORD`, `COOKIE_SECURE`, `LOW_STOCK`, `ADMIN_TOKEN` (opcional, para scripts), `STORE_NAME`, `WHATSAPP_NUMBER`, `CORS_ORIGINS`,
`PUBLIC_SITE_URL`, `PUBLIC_API_URL`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`.

## Para producción

* PostgreSQL + Alembic; `uvicorn --workers 2` detrás de Nginx/Caddy (o Railway/Render/Fly).
* Frontend en Vercel; después de importar, llamar a `revalidateTag("catalog")` para refrescar el ISR al instante.
* Mercado Pago: probar con credenciales de prueba, configurar la URL del webhook en el panel
  (evento *Pagos*) y copiar la clave secreta en `MP_WEBHOOK_SECRET`.
* Imágenes: servir desde un CDN en WebP/AVIF de ~400 px.
