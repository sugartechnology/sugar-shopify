# Sugar Shopify PDP App

Shopify Remix uygulaması + Theme App Extension. PDP'de buton açar, popup'ta müşteriden oda fotoğrafı ister (galeri veya kamera), ürün görsellerini Sugar API'ye gönderir ve üretilen görseli sepete line item property olarak ekler.

## Gereksinimler

- Node.js >= 20.19
- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli)
- Shopify Partners hesabı + development store

## Kurulum

```bash
cd sugar-shopify
npm install
npm run setup
cp .env.example .env
```

Partners'ta app oluşturup bağlayın:

```bash
shopify app config link   # veya: npm run shopify -- app config link
npm run dev               # shopify app dev — projeden çalıştırın
```

> **Not:** `shopify: command not found` alırsanız komutu doğrudan terminalde değil, proje klasöründen `npm run dev` ile çalıştırın. CLI projeye `@shopify/cli` olarak eklenmiştir. Global kurulum isterseniz: `npm install -g @shopify/cli`

> **Node sürümü:** Proje Node `>=20.19 <22` veya `>=22.12` gerektirir. Node 23 desteklenmez; `nvm use 22` ile LTS kullanın.

`shopify app dev` tunnel'ı app proxy'yi (`/apps/sugar/generate`) storefront'tan erişilebilir kılar. Tunnel olmadan generate istekleri çalışmaz.

## Mock mod (geliştirme)

Sugar API bağlanmadan akışı test etmek için `.env` içinde:

```
SUGAR_API_MOCK=true
```

Mock modda:
- App proxy çalışır ve ~1.2s gecikme simüle eder
- Yüklenen oda fotoğrafı sonuç ekranında geri gösterilir (echo)
- Sonuç ekranında "Demo mod" rozeti görünür

Gerçek API'ye geçmek için `SUGAR_API_MOCK=false` yapın ve admin ayarlarından Sugar API bilgilerini doldurun.

## Admin ayarları

`/app/settings` sayfasından:

- Sugar API Base URL, Company ID, API Key
- Popup metinleri (başlık, açıklama, loading metinleri)
- Tema CSS class mapping (Dawn / Normod preset veya custom)
- Sepet property anahtarları (`_sugar_design_image`, `_sugar_generation_id`)
- Ek ürün collection handle, max upload boyutu

**Fallback zinciri:** Block settings (Theme Editor) → shop metafields (`sugar_shopify` namespace, admin'den kaydedilir) → kod içi varsayılanlar.

## Theme Editor

1. Online Store → Customize
2. Product template → Add block → **Sugar PDP**
3. İsteğe bağlı: block ayarlarından buton metni, popup metinleri, ek ürün collection, tema CSS class'ları
4. Tema buton class'larını (Dawn: `button button--primary` vb.) block veya admin preset'inden eşleştirin

## App Proxy

Storefront istekleri: `POST /apps/sugar/generate`

Remix route: [`app/routes/apps.sugar.generate.tsx`](app/routes/apps.sugar.generate.tsx)

Proxy config: [`shopify.app.toml`](shopify.app.toml)

```toml
[app_proxy]
url = "/apps/sugar"
subpath = "sugar"
prefix = "apps"
```

### Storefront → App Proxy isteği

**Content-Type:** `multipart/form-data`

| Alan | Tip | Açıklama |
|------|-----|----------|
| `products` | JSON string | Seçili ürünler dizisi (aşağıda) |
| `roomImageBase64` | string | Oda fotoğrafı (base64, data URL prefix olmadan) |
| `roomImageName` | string | Dosya adı (ör. `room.jpg`) |

**products dizisi elemanı:**

```json
{
  "productId": "123456789",
  "variantId": "987654321",
  "title": "Ürün Adı",
  "handle": "urun-adi",
  "price": "19900",
  "currency": "TRY",
  "imageUrl": "https://cdn.shopify.com/...",
  "images": ["https://cdn.shopify.com/..."],
  "isPrimary": true
}
```

### App Proxy yanıtı

```json
{
  "generationId": "uuid-or-mock-timestamp",
  "imageUrl": "https://cdn.example/result.png",
  "thumbnailUrl": "https://cdn.example/thumb.png",
  "status": "completed",
  "message": "optional",
  "products": [
    {
      "productId": "123456789",
      "variantId": "987654321",
      "title": "Ürün Adı",
      "price": "19900",
      "currency": "TRY",
      "imageUrl": "https://cdn.shopify.com/...",
      "selectedByDefault": true
    }
  ]
}
```

## Sugar API sözleşmesi (harici backend)

App proxy, gerçek modda isteği Sugar API'ye iletir:

```
POST {sugarApiBaseUrl}/api/shopify/pdp/generate
Authorization: Bearer {sugarApiKey}
X-Company-Id: {companyId}   (opsiyonel)

multipart/form-data:
  shopDomain    — mağaza domain'i
  products      — JSON string (yukarıdaki products dizisi)
  roomImage     — binary dosya (oda fotoğrafı)
```

Yanıt formatı app proxy yanıtı ile aynıdır (`GenerateImageResponse`).

Implementasyon: [`app/services/sugar-api.server.ts`](app/services/sugar-api.server.ts)

## PDP akışı

**Kısa akış** (ek ürün collection yok veya block'ta "Ürün seçim adımını atla" açık):

1. **Upload** — Galeri veya kamera ile oda fotoğrafı
2. **Loading** — App proxy → Sugar API (veya mock)
3. **Result** — AI önizleme + sepete ekleme

**Tam akış** (ek ürün collection tanımlı):

1. **Upload** — Galeri veya kamera ile oda fotoğrafı
2. **Products** — Ana PDP ürünü + collection'dan ek ürünler
3. **Loading** — App proxy → Sugar API (veya mock)
4. **Result** — AI önizleme + seçili ürünleri sepete ekleme (`/cart/add.js`)

Varyant değişimi: müşteri PDP'de farklı varyant seçtiğinde block, o varyantın görselini otomatik günceller.

## Manuel test checklist

- [ ] AI butonu PDP'de görünüyor
- [ ] Butona tıklayınca popup açılıyor
- [ ] Galeri/kamera ile fotoğraf seçilebiliyor
- [ ] Ürün chip'leri görünüyor (ana ürün seçili)
- [ ] "Tasarla" → loading → result adımları çalışıyor
- [ ] Mock modda yüklenen oda fotoğrafı sonuç ekranında görünüyor
- [ ] Varyant değiştirince ürün görseli güncelleniyor
- [ ] Sepete ekleme çalışıyor; line item property'ler yazılıyor

## CSS özelleştirme

- Block settings: tema class mapping
- Admin: özel CSS + preset
- Extension CSS: `.sugar-modal`, `.sugar-ai-btn`, CSS variables (`--sugar-modal-radius` vb.)

## Proje yapısı

```
sugar-shopify/
├── app/                              # Remix backend (admin + app proxy)
│   ├── routes/apps.sugar.generate.tsx
│   ├── routes/app.settings.tsx
│   └── services/sugar-api.server.ts
├── extensions/sugar-pdp/             # Theme App Extension (PDP UI)
│   ├── blocks/product-customizer.liquid
│   └── assets/sugar-pdp.js
├── prisma/                           # Session storage
└── shopify.app.toml
```
