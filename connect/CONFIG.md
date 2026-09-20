# Sugar Connect — değerler ve kaynakları

Bu dosya CRM + Connect env’lerinin **ne olduğunu**, **örnek değerini** ve **nereden geldiğini** anlatır. `application.yml` içindeki `${...}` satırları YAML’e yazılmaz; `sugar-crm-service/setup/env.local` (veya prod env) içine konur.

## Kim ne tutar

| Değer | Nerede durur | Shopify Partners / Admin’den mi? |
|---|---|---|
| `SHOPIFY_SERVICE_SECRET` | CRM env + Connect `.env` (aynı) | Hayır. Sen üretirsin. |
| `SUGAR_CONNECT_BASE_URL` | Yalnızca CRM env | Hayır. Connect’in public URL’si. |
| `CRM_WEB_PUBLIC_BASE_URL` | CRM env + Connect `.env` | Hayır. Super-admin web origin. |
| `CRM_BASE_URL` | Yalnızca Connect `.env` | Hayır. CRM API host ( `/api` olmadan). |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | Yalnızca Connect `.env` | Evet. Partners → Sugar Connect app. |
| `SHOPIFY_APP_URL` | Yalnızca Connect `.env` | Hayır. Connect’in kendi public URL’si. |
| `SCOPES` | Connect `.env` | Sabit: `read_products,write_products` |
| `DATABASE_URL` | Connect `.env` | Hayır. Yalnızca Shopify `Session` (token). Lokal SQLite, prod Postgres. |
| Mağaza offline token | Connect Prisma `Session` | OAuth sonrası Shopify verir. Env’e yazılmaz. |
| `shop_domain` / `shop_gid` | CRM tablosu `shopify_shop_links` | Install sonrası callback ile gelir. Env’e yazılmaz. |

CRM’e Client ID, Client Secret, Admin token (`shpat_`), shop domain yapıştırılmaz.

## 1) Senin ürettiğin ortak secret

**Değişken:** `SHOPIFY_SERVICE_SECRET`

**Ne işe yarar:** CRM ↔ Connect `X-Service-Secret` doğrulaması. Install callback ve katalog upsert.

**Nereden gelir:** Sen üretirsin.

```bash
openssl rand -hex 32
```

**Örnek (sahte):** `7f3c1a9e2b44d0c8a16f5e0d9b7a3344c2e18f0a91bb5476d3c0aa11ee22ff09`

**Nereye yazılır:**

```bash
# sugar-crm-service/setup/env.local
SHOPIFY_SERVICE_SECRET=7f3c1a9e2b44d0c8a16f5e0d9b7a3344c2e18f0a91bb5476d3c0aa11ee22ff09

# sugar-shopify/connect/.env
SHOPIFY_SERVICE_SECRET=7f3c1a9e2b44d0c8a16f5e0d9b7a3344c2e18f0a91bb5476d3c0aa11ee22ff09
```

İki değer **byte-byte aynı** olmalı.

## 2) CRM `application.yml` shopify bloğu

Kaynak dosya: `sugar-crm-service/setup/env.local`

### `SHOPIFY_SERVICE_SECRET`

Yukarıdaki ortak secret. Boşsa Connect “configured değil” sayılır.

### `SUGAR_CONNECT_BASE_URL`

**Ne işe yarar:** Super-admin Connect butonu bu kökü açar (`/connect/start?state=...`). Aktarım job’u `POST {bu-url}/internal/catalog/upsert` atar.

**Nereden gelir:** Connect process’inin dışarıdan görünen adresi. Shopify’dan alınmaz.

| Ortam | Örnek | Kaynak |
|---|---|---|
| İlk lokal (port 3100) | `http://localhost:3100` | `connect/vite.config.ts` default port |
| `shopify app dev` | `https://xxxx.trycloudflare.com` | CLI’nin yazdığı **App URL** |
| Prod | `https://connect.sugartech.io` | Sizin host / DNS |

Sonda `/` olmasın.

```bash
SUGAR_CONNECT_BASE_URL=http://localhost:3100
```

### `CRM_WEB_PUBLIC_BASE_URL` (yoksa `CRM_PUBLIC_BASE_URL`)

**Ne işe yarar:** OAuth bitince Connect’in super-admin şirket listesine dönüş adresi. CRM, return URL’yi buna göre üretir: `{web}/super-admin/companies?shopify=connected&companyId=...`

**Nereden gelir:** `sugar-crm-web`’in tarayıcıdaki origin’i. Shopify’dan alınmaz.

| Ortam | Örnek | Kaynak |
|---|---|---|
| Lokal | `http://localhost:3001` | CRM web’in `next dev` portu (`package.json` / `.env`) |
| Prod | `https://portal.coorai.app` | Canlı super-admin host |

Web 3000’deyse 3000 yaz. CRM ve Connect’teki web origin **aynı** olsun.

```bash
CRM_PUBLIC_BASE_URL=http://localhost:3001
CRM_WEB_PUBLIC_BASE_URL=http://localhost:3001
```

### `SHOPIFY_CONNECT_SESSION_TTL`

**Ne işe yarar:** Connect butonuna basınca oluşan imzalı session ömrü.

**Nereden gelir:** İsteğe bağlı. Boş bırak → `PT15M` (15 dakika). Shopify’dan alınmaz.

```bash
# yazmana gerek yok
# SHOPIFY_CONNECT_SESSION_TTL=PT15M
```

### Lokal CRM env (kopyala-yapıştır iskeleti)

```bash
SHOPIFY_SERVICE_SECRET=7f3c1a9e2b44d0c8a16f5e0d9b7a3344c2e18f0a91bb5476d3c0aa11ee22ff09
SUGAR_CONNECT_BASE_URL=http://localhost:3100
CRM_WEB_PUBLIC_BASE_URL=http://localhost:3001
```

## 3) Connect `.env` — Shopify’dan gelen tek parça

Dosya: `sugar-shopify/connect/.env` (`cp .env.example .env`)

### `SHOPIFY_API_KEY`

**Ne işe yarar:** Partners app Client ID. OAuth / custom install link.

**Nereden gelir:** [Shopify Partners](https://partners.shopify.com) → Apps → **yeni app: Sugar Connect** (Room Studio değil) → Client ID.  
veya `cd connect && shopify app config link` sonrası `shopify.app.toml` içindeki `client_id`.

**Örnek:** `fb637727ba79d899ffbefcf10aa09f69` (bu Room Studio’nun ID’si; Connect için **yeni** ID gelir)

### `SHOPIFY_API_SECRET`

**Ne işe yarar:** Partners app Client Secret. OAuth code değişimi.

**Nereden gelir:** Aynı Partners app ekranı → Client secret. CRM’e konmaz.

**Örnek:** `shpss_xxxxxxxx` (Partners gösterir, bir kez kopyala)

### `SCOPES`

**Örnek:** `read_products,write_products`

**Nereden gelir:** Sabit. Partners app scope’u da bu olmalı.

### `SHOPIFY_APP_URL`

**Ne işe yarar:** Shopify’ın OAuth callback ve embedded app için bildiği Connect URL.

**Nereden gelir:** Connect’in public URL’si. Lokal `shopify app dev` çoğu zaman bunu kendisi yazar. Prod’da senin host.

| Ortam | Örnek |
|---|---|
| Lokal tunnel | `https://xxxx.trycloudflare.com` |
| Prod | `https://connect.sugartech.io` |

`SUGAR_CONNECT_BASE_URL` (CRM) ile **aynı origin** olmalı.

### `DATABASE_URL`

**Ne işe yarar:** Offline session / mağaza token’ı. Tek kopya burada.

**Nereden gelir:** Sen verirsin. Shopify’dan alınmaz.

```bash
# lokal
DATABASE_URL=file:./dev.sqlite
# prod — kalıcı token; schema provider o zaman postgresql olmalı
# DATABASE_URL=postgresql://connect:SECRET@db-host:5432/sugar_connect
```

### `CRM_BASE_URL`

**Ne işe yarar:** Install / uninstall bildirimi. Connect → `POST {CRM_BASE_URL}/internal/shopify/shops/installed`

**Nereden gelir:** CRM service host. **`/api` ekleme.** Internal path `/api` altında değil.

| Ortam | Örnek |
|---|---|
| Lokal | `http://localhost:9495` (`SERVER_PORT`) |
| Prod | `https://crm-api.ornek.com` |

### Connect `.env` iskeleti

```bash
SHOPIFY_API_KEY=partners_connect_client_id
SHOPIFY_API_SECRET=partners_connect_client_secret
SCOPES=read_products,write_products
SHOPIFY_APP_URL=http://localhost:3100
DATABASE_URL=file:./dev.sqlite
SHOPIFY_SERVICE_SECRET=7f3c1a9e2b44d0c8a16f5e0d9b7a3344c2e18f0a91bb5476d3c0aa11ee22ff09
CRM_BASE_URL=http://localhost:9495
CRM_WEB_PUBLIC_BASE_URL=http://localhost:3001
```

`SHOPIFY_API_KEY` / `SECRET` boşsa OAuth başlamaz; CRM shopify bloğu yine de doldurulmuş olabilir.

## 4) Env’de olmayan, akışta gelen değerler

Bunları hiçbir `.env`’e yazma.

| Değer | Ne zaman gelir | Nereye yazılır |
|---|---|---|
| Shop domain (`magaza.myshopify.com`) | Merchant Install / Shopify hesap seçici | CRM `shopify_shop_links.shop_domain` |
| Shop GID (`gid://shopify/Shop/123`) | Connect `shop { id }` sorgusu | CRM `shopify_shop_links.shop_gid` |
| Offline Admin token | Shopify OAuth callback | Connect Prisma `Session.accessToken` |
| Product / variant GID | Aktarım `productSet` | CRM `shopify_entity_links` + Shopify `sugar` metafield |

## 5) Lokal sıra

1. `openssl rand -hex 32` → `SHOPIFY_SERVICE_SECRET`
2. Partners’ta **Sugar Connect** app aç (Room Studio’dan ayrı). Client ID/Secret’ı Connect `.env`’e koy.
3. CRM `setup/env.local` içine secret + `SUGAR_CONNECT_BASE_URL` + web origin.
4. Connect `.env` içine secret + `CRM_BASE_URL` + web origin + Partners key’leri.
5. CRM: `setup/run-local.sh` (veya IDE). Web: her zamanki `next dev`.
6. Connect: `cd sugar-shopify/connect && npm install && npm run setup && npm run dev`
7. CLI yeni bir App URL verdiyse hem `SHOPIFY_APP_URL` hem CRM `SUGAR_CONNECT_BASE_URL` onu olsun; CRM’i restart et.
8. Super-admin → şirket satırı → **Connect**. Shop domain’i sen yazmazsın; Shopify sorar.

## 6) Prod örnekleri (sahte host)

CRM env:

```bash
SHOPIFY_SERVICE_SECRET=7f3c1a9e2b44d0c8a16f5e0d9b7a3344c2e18f0a91bb5476d3c0aa11ee22ff09
SUGAR_CONNECT_BASE_URL=https://connect.sugartech.io
CRM_WEB_PUBLIC_BASE_URL=https://portal.coorai.app
```

Connect env:

```bash
SHOPIFY_API_KEY=prod_connect_client_id
SHOPIFY_API_SECRET=prod_connect_client_secret
SCOPES=read_products,write_products
SHOPIFY_APP_URL=https://connect.sugartech.io
DATABASE_URL=postgresql://...
SHOPIFY_SERVICE_SECRET=7f3c1a9e2b44d0c8a16f5e0d9b7a3344c2e18f0a91bb5476d3c0aa11ee22ff09
CRM_BASE_URL=https://crm-api.ornek.com
CRM_WEB_PUBLIC_BASE_URL=https://portal.coorai.app
```

Partners’ta redirect URL: `https://connect.sugartech.io/auth/callback`. Custom distribution yeter.
