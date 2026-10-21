# Koshoy Studio

Koshoy mağazası için ayrı Shopify uygulaması (custom distribution). Vitrindeki
`/apps/koshoy/studio/{session,turn,edit,cart}` App Proxy isteklerini karşılar:
AI sohbet turu (LLM gateway üzerinden, `koshoy-chat` etiketi), dolap tasarımı
düzenleme, fiyatlama ve sepet satırları. `connect/` gibi sugar-shopify içinde
bağımsız bir alt klasördür; kendi `package.json`, Prisma (SQLite) ve
`shopify.app.toml` dosyası vardır. Kök uygulamayla kod paylaşmaz.

## Ortam değişkenleri

Hepsi `.env.example` içinde açıklamalı. Özet:

| Değişken | Açıklama |
| --- | --- |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL` | Partner app bilgileri |
| `DATABASE_URL` | SQLite, Docker'da `file:/app/data/prod.sqlite` |
| `LLM_GATEWAY_URL` | tagservice adresi (yoksa `SUGAR_API_BASE_URL` okunur; ikisi de boşsa sohbet mock) |
| `SHOPIFY_SERVICE_SECRET` | Kurulumda mağaza anahtarını gateway'e kaydetmek için |
| `KOSHOY_SHOPS` | Stüdyonun açık olduğu mağazalar (virgülle) |
| `KOSHOY_CHAT_MOCK`, `KOSHOY_PRICE_MOCK` | `1` = örnek sohbet / örnek fiyat |
| `KOSHOY_DEV_SUGAR_API_KEY` | Yalnızca production dışı: DB yerine bu anahtarı kullan |

Mağaza API anahtarı kurulumda (`afterAuth`) otomatik üretilir,
`/api/shopify/credentials/register` ile gateway'e kaydedilir ve
`ShopCredential` tablosunda saklanır. Uygulama kaldırılınca silinir.

## Geliştirme

```sh
cd koshoy
npm install
npm run setup          # prisma generate + migrate deploy
npm test               # koshoy testleri
npm run dev            # shopify app dev (yalnızca bu klasör)
npm run sync:cabinet-core   # ../../3d-room-designer/src/core/cabinet kopyası
```

Tam yerel ortam (vitrin emülatörü + 3D + backend):
`pnp-shopify-project/devenv` içinde `docker compose up`.

## Deploy

```sh
cd koshoy
cp .env.example .env.production   # doldur
docker compose -f docker-compose.prod.yml up -d --build
```

Container açılışta `prisma migrate deploy` çalıştırır; veritabanı
`/app/data` volume'undadır. `https://koshoy.sugartech.io` bu container'a
yönlendirilmelidir.

## Partner Dashboard adımları

1. `cd koshoy && npx shopify app deploy` — `shopify.app.toml` (URL'ler, App
   Proxy `apps/koshoy` → `https://koshoy.sugartech.io/apps/koshoy`, webhook)
   yüklenir.
2. Partner Dashboard → Koshoy Studio → Distribution → **Custom distribution**,
   mağaza: `21tn4m-us.myshopify.com`. Oluşan kurulum linkiyle mağazaya kur.
3. Kurulumdan sonra admin'de uygulamayı aç: "Koshoy Studio kurulu" ve API
   anahtarı durumu görünür.
4. Production'da `KOSHOY_SHOPS=21tn4m-us.myshopify.com` ayarlı olmalı.
