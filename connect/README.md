# Sugar Connect

Bu klasör **Room Studio değil**. İki ayrı Shopify uygulaması var:

| | Room Studio | Sugar Connect |
|---|---|---|
| Klasör | `sugar-shopify/` kök | `sugar-shopify/connect/` |
| Ne iş | mağaza vitrini (PDP, AI) | CRM’den ürün yazma |
| Çalıştırma | kökte `npm run dev` | burada `npm run dev` |
| Anahtar | kök `.env` | bu klasörün `.env` |

Connect, CRM’e `http://localhost:3100` üzerinden konuşur.

## Lokal (3 adım)

1. Shopify Partners’ta **yeni** bir app aç (Room Studio’yu kullanma).
2. Client ID / Secret’ı bu klasördeki `.env` içine yaz.
3. `npm install && npm run setup && npm run dev`

CRM tarafı: `setup/env.local` içindeki `SHOPIFY_SERVICE_SECRET` bu `.env` ile aynı. CRM’i restart et.

`shopify app config link` sadece Connect app’ini `shopify.app.toml` ile bağlar. Kök Room Studio app’ine bağlama.
