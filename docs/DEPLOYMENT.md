# Sugar Shopify — Mimari, projeler ve deploy rehberi

Bu doküman repodaki **üç ayrı parçayı** net ayırır: ne nerede çalışır, kim deploy eder, geliştirmede ve production’da hangi komutları kullanırsın.

---

## Production URL (SugarTech)

Remix backend (B1) production adresi:

| Alan | Değer |
|------|--------|
| **App URL (B1)** | `https://storefront.sugartech.io` |
| **`SHOPIFY_APP_URL` env** | `https://storefront.sugartech.io` |
| **Uygulama adı (Partners / Admin)** | **Sugar Room Studio** |
| **Embedded admin** | `https://storefront.sugartech.io/srs` |
| **Admin ayarlar** | `https://storefront.sugartech.io/srs/settings` |
| **OAuth callback** | `https://storefront.sugartech.io/auth/callback` (Remix auth prefix) |
| **App Proxy (storefront)** | `https://{shop}.myshopify.com/apps/sugar/generate` → Shopify proxy → `https://storefront.sugartech.io/apps/sugar/generate` |

Partners → **App setup** alanında güncellenecekler:

| Partners alanı | Production değeri |
|----------------|-------------------|
| App URL | `https://storefront.sugartech.io` |
| Allowed redirection URL(s) | `https://storefront.sugartech.io/auth/callback` (ve CLI’nin ürettiği diğer `/auth/*` path’leri) |

> **Not:** Storefront müşterisi `storefront.sugartech.io` adresini **görmez**. PDP istekleri mağaza domain’i üzerinden App Proxy ile bu sunucuya gider.
>
> **İsimlendirme:** Embedded admin yolu `/srs` (Sugar Room Studio). Storefront proxy yolu `/apps/sugar/...` — bu Shopify App Proxy convention’ıdır, uygulama adından bağımsızdır.

---

## 1. Büyük resim

Bu çözüm **tek monorepo** içinde iki Shopify parçası + harici bir AI backend’den oluşur:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PROJE A — sugar-shopify (bu repo)                                      │
│  ┌─────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │ B1: Remix backend           │  │ B2: Theme App Extension          │ │
│  │ app/ + prisma/              │  │ extensions/sugar-pdp/          │ │
│  │ Senin Node sunucun          │  │ Shopify CDN / tema               │ │
│  └──────────────┬──────────────┘  └──────────────────────────────────┘ │
└─────────────────┼───────────────────────────────────────────────────────┘
                  │ mock: kendi içinde
                  │ prod: HTTP
                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  PROJE B — tagservicee (api.sugartech.io)                               │
│  Shop Bearer auth, /api/shopify/pdp/generate, key registry              │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ Basic auth (DECOR_AI_USERNAME/PASSWORD)
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  PROJE C — sugar-decor-ai-services (ai.sugartech.io)                   │
│  POST /api/ai/commands/with-files — mevcut Basic/JWT auth               │
└─────────────────────────────────────────────────────────────────────────┘
```

**Müşteri tarayıcısı Sugar API’ye asla direkt gitmez.** Akış her zaman:

`Storefront JS → Shopify App Proxy → storefront (Remix) → api.sugartech.io → ai.sugartech.io`

---

## 2. Proje / parça tablosu

| Parça | Kod konumu | Ne iş yapar | Kim deploy eder | Nereye deploy |
|-------|------------|-------------|-----------------|---------------|
| **B1 — Remix backend** | `app/`, `prisma/`, `shopify.app.toml` | Admin UI, OAuth, session, app proxy, mock/gerçek API köprüsü | **Sen** | `https://storefront.sugartech.io` (Node host) |
| **B2 — Theme extension** | `extensions/sugar-pdp/` | PDP butonu, modal, galeri/kamera, sepete ekle UI | **Shopify CLI** (`shopify app deploy`) | Shopify (mağaza teması + CDN asset) |
| **B2 — API gateway** | `tagservicee` repo | Shop key auth, PDP generate, AI proxy | **Sen** | `https://api.sugartech.io` |
| **C — Sugar AI API** | `sugar-decor-ai-services` | AI görsel üretimi (`/api/ai/commands/with-files`) | **Sen** | `https://ai.sugartech.io` (internal only) |
| **Shopify platform** | — | App Proxy yönlendirme, Admin embed, Cart API | Shopify | Shopify altyapısı |

---

## 3. Dosya → sorumluluk tablosu

### B1 — Remix backend (`app/`)

| Dosya / klasör | Rol | Deploy edilir mi? |
|-----------------|-----|-------------------|
| `app/routes/apps.sugar.generate.tsx` | App Proxy girişi (`POST /apps/sugar/generate`) | Evet — Node bundle içinde |
| `app/services/sugar-api.server.ts` | Mock veya gerçek Sugar API çağrısı | Evet — Node bundle içinde |
| `app/services/shop-config.server.ts` | Admin ayarlarını metafield’dan okur/yazar | Evet |
| `app/routes/srs.settings.tsx` | Embedded admin ayar sayfası | Evet |
| `app/routes/srs.tsx`, `srs._index.tsx` | Admin shell / ana sayfa | Evet |
| `app/shopify.server.ts` | Shopify auth, session | Evet |
| `prisma/` | OAuth session DB (SQLite) | Docker volume ile kalıcı |
| `shopify.app.toml` | App kimliği, scope, **app proxy config** | Partners + CLI deploy |

**Build çıktısı:** `npm run build` → `build/server/index.js`  
**Çalıştırma:** `npm run start` (production)

### B2 — Theme extension (`extensions/sugar-pdp/`)

| Dosya / klasör | Rol | Deploy edilir mi? |
|-----------------|-----|-------------------|
| `assets/sugar-pdp.js` | Storefront orchestrator (modal, proxy, sepet) | Evet — Shopify asset |
| `assets/sugar-pdp-core.js`, `sugar-mockup-editor.js`, … | Modüler UI bileşenleri | Evet |
| `assets/sugar-pdp.css` | Modal / buton stilleri, CSS variables | Evet |
| `snippets/sugar-pdp-root.liquid` | Markup + config JSON + i18n | Evet |
| `blocks/product-customizer.liquid` | App block şeması (Theme Editor) | Evet |
| `blocks/sugar-pdp-embed.liquid` | App embed (body) | Evet |
| `locales/*.json` | TR/EN storefront metinleri | Evet |

**Deploy:** `npm run deploy` veya `shopify app deploy`  
**Çalışma yeri:** Müşterinin tarayıcısı + Shopify tema CDN

### C — Sugar AI API (harici)

| Beklenen endpoint | Çağıran | Kim deploy eder |
|-------------------|---------|-----------------|
| `POST /api/shopify/pdp/generate` | `sugar-api.server.ts` (mock kapalıyken) | Sugar ekibi / sen |

Sözleşme: [`README.md`](../README.md) → “Sugar API sözleşmesi” ve `app/types/sugar.ts` → `GenerateImageResponse`.

---

## 4. Ortam tablosu (dev vs prod)

| | **Geliştirme** | **Production (SugarTech)** |
|--|----------------|---------------------------|
| **Remix backend** | Laptop — `npm run dev` | `https://storefront.sugartech.io` — `npm run build && npm run start` |
| **Public URL** | Shopify CLI tunnel (geçici) | `https://storefront.sugartech.io` |
| **Theme extension** | CLI hot-sync (dev store) | `shopify app deploy` |
| **App Proxy hedefi** | Tunnel URL | `https://storefront.sugartech.io` (`SHOPIFY_APP_URL`) |
| **Mock AI** | `.env` → `SUGAR_API_MOCK=true` | `SUGAR_API_MOCK=false` + admin API ayarları |
| **Session DB** | `prisma/dev.sqlite` | SQLite volume (`prod.sqlite`) |
| **Sugar API** | Gerekmez (mock) | Canlı AI servisin (ayrı host) |

---

## 5. Deploy adımları — senin yapacağın işler

### Adım 1 — Remix backend’i host et (B1)

Production host: **`https://storefront.sugartech.io`**

**Docker ile (önerilen):** aşağıdaki [§5.1 Docker Compose](#51-docker-compose) bölümüne bak.

**Manuel Node deploy:**

1. Node sunucusunu bu domain’e bağla (TLS sertifikası zorunlu).
2. Ortam değişkenlerini ayarla:

   | Değişken | Production değeri |
   |----------|-------------------|
   | `SHOPIFY_API_KEY` | Partners app Client ID |
   | `SHOPIFY_API_SECRET` | Partners app secret |
   | `SHOPIFY_APP_URL` | `https://storefront.sugartech.io` |
   | `SCOPES` | `read_products,write_products` |
   | `DATABASE_URL` | `file:/app/prisma/prod.sqlite` (Docker) |
   | `HOST` | `0.0.0.0` |
   | `SUGAR_API_MOCK` | `false` (canlı AI için) |

3. Build ve start:

   ```bash
   npm ci
   npm run setup    # prisma migrate
   npm run build
   npm run start
   ```

4. Partners → App setup:

   | Alan | Değer |
   |------|--------|
   | App URL | `https://storefront.sugartech.io` |
   | Allowed redirection URL(s) | `https://storefront.sugartech.io/auth/callback` |

5. Smoke test (deploy sonrası):

   ```bash
   curl -I https://storefront.sugartech.io
   # Admin embed açılıyor mu: Shopify Admin → Apps → Sugar Room Studio
   # Proxy: PDP’den “Tasarla” → Network’te POST .../apps/sugar/generate → 200
   ```

### Adım 2 — App Proxy’yi doğrula (Shopify ↔ backend köprüsü)

Storefront isteği:

```
POST https://sugartechtest.myshopify.com/apps/sugar/generate   ← müşteri tarayıcısı (örnek dev store)
         │
         ▼  (Shopify App Proxy, HMAC imzalı)
POST https://storefront.sugartech.io/apps/sugar/generate    ← Remix route
```

Proxy config (`shopify.app.toml`):

```toml
application_url = "https://storefront.sugartech.io"

[app_proxy]
url = "/apps/sugar"
subpath = "sugar"
prefix = "apps"
```

### Adım 3 — Theme extension’ı deploy et (B2)

```bash
shopify app deploy
```

Bu komut:
- `extensions/sugar-pdp/` dosyalarını Shopify’a push eder
- App config’i Partners’a yazar

**Remix sunucusunu deploy etmez.**

### Adım 4 — Mağazada extension’ı aç

1. Online Store → Customize
2. **App embeds** → “Sugar Room Studio” aç **veya**
3. Product template → Add block → Apps → “Sugar Room Studio”

### Adım 5 — Sugar AI API’yi bağla (C)

1. Shopify Admin → **Sugar Room Studio** → **Ayarlar** (`/srs/settings`)
2. Sugar API Base URL, Company ID, API Key doldur
3. `.env` → `SUGAR_API_MOCK=false`
4. Backend’i yeniden deploy et

Mock’u değiştirmek için **sadece B1** yeterli (`sugar-api.server.ts`); extension’a dokunmana gerek yok.

---

## 5.1 Docker Compose

| Dosya | Amaç |
|-------|------|
| `Dockerfile` | Multi-stage Remix production image |
| `docker-compose.yml` | Local: app + SQLite volume |
| `docker-compose.prod.yml` | Production: app + SQLite volume |
| `.env.local.example` | Local env şablonu → kopyala: `.env.local` |
| `.env.production.example` | Prod env şablonu → kopyala: `.env.production` |
| `docker/entrypoint.sh` | `prisma migrate deploy` + `npm run start` |

### Local Docker

```bash
cp .env.local.example .env.local
# SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL doldur

docker compose up --build
# veya: npm run docker:local
```

App: `http://localhost:3000`

> Shopify tunnel hâlâ gerekli: `SHOPIFY_APP_URL` HTTPS olmalı. Docker app’i `:3000`’de dinler; `shopify app dev` tunnel’ını bu porta yönlendir veya ngrok kullan.

### Production Docker

Sunucuda (`storefront.sugartech.io`):

```bash
cp .env.production.example .env.production
# Secret'ları doldur (SHOPIFY_*)

docker compose -f docker-compose.prod.yml up -d --build
# veya: npm run docker:prod
```

Reverse proxy (nginx/Caddy) TLS termination → `localhost:3000`.

| Env dosyası | `SHOPIFY_APP_URL` | `SUGAR_API_MOCK` |
|-------------|-------------------|------------------|
| `.env.local` | Tunnel URL | `true` |
| `.env.production` | `https://storefront.sugartech.io` | `false` |

**Not:** Session storage **SQLite** — sadece Shopify OAuth oturumları için. Tek container deploy için yeterli; ayrı Postgres gerekmez.

---

## 6. İstek akış tablosu

| Adım | Kaynak | Hedef | Protokol | Not |
|------|--------|-------|----------|-----|
| 1 | Müşteri tarayıcısı | `POST https://{shop}/apps/sugar/generate` | HTTPS (shop domain) | `sugar-pdp.js` |
| 2 | Shopify App Proxy | `POST https://storefront.sugartech.io/apps/sugar/generate` | Proxy + HMAC | API key tarayıcıda yok |
| 3a | Remix | `mockResponse()` | In-process | `SUGAR_API_MOCK=true` |
| 3b | Remix | Sugar API `/api/shopify/pdp/generate` | Server-to-server | Bearer token |
| 4 | Remix | Tarayıcı | JSON | `generationId`, `imageUrl`, … |
| 5 | Tarayıcı | `POST /cart/add.js` | Shopify Cart API | Line item properties |

---

## 7. Mock vs gerçek API — karar tablosu

| Koşul | Davranış | Değiştirdiğin yer |
|-------|----------|-------------------|
| `SUGAR_API_MOCK !== "false"` | Mock (echo + 1.2s gecikme) | `app/services/sugar-api.server.ts` |
| Admin’de `sugarApiBaseUrl` boş | Mock | Admin ayarları |
| `SUGAR_API_MOCK=false` + URL dolu | Gerçek Sugar API | Harici proje C + admin key |

---

## 8. Komut özeti

| Komut | Ne yapar | Hangi parça |
|-------|----------|-------------|
| `npm run dev` | Local Remix + CLI tunnel + extension sync | B1 + B2 (dev) |
| `npm run build` | Remix production bundle | B1 |
| `npm run start` | Production Node server | B1 |
| `npm run deploy` | Extension + app config → Shopify | B2 |
| `npm run docker:local` | Local Docker stack (app + SQLite volume) | B1 |
| `npm run docker:prod` | Production Docker stack | B1 |
| `npm test` | Mock API unit test + PDP flow check | B1 |

---

## 9. Sık karışan noktalar

| Soru | Cevap |
|------|-------|
| `sugar-api.server.ts` ayrı servis mi? | Hayır. Remix sunucusunun içindeki modül. |
| `shopify app deploy` backend’i de atar mı? | Hayır. Sadece extension + Partners config. |
| Client Sugar API’ye direkt gidebilir mi? | Hayır. Güvenlik (API key) + CORS. Proxy kullan. |
| Mock’u değiştirince extension deploy? | Gerekmez. Sadece B1’i yeniden deploy et. |
| Sepete ekleme nereye gider? | Doğrudan Shopify `/cart/add.js` (Sugar’a değil). |

---

## 10. İlgili dosyalar

- Genel kurulum: [`README.md`](../README.md)
- Proxy route: [`app/routes/apps.sugar.generate.tsx`](../app/routes/apps.sugar.generate.tsx)
- Mock / API client: [`app/services/sugar-api.server.ts`](../app/services/sugar-api.server.ts)
- Storefront JS: [`extensions/sugar-pdp/assets/sugar-pdp.js`](../extensions/sugar-pdp/assets/sugar-pdp.js)
- Tip sözleşmesi: [`app/types/sugar.ts`](../app/types/sugar.ts)
