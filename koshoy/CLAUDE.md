# Koshoy Studio — backend

Koshoy (PnP'nin yeni markası) mağazasının yapay zeka tasarım asistanının arka yüzü.
Ayrı bir Shopify app'idir (Koshoy Studio), `connect/` gibi sugar-shopify içinde
bağımsız bir alt klasördür: kendi `package.json`, Prisma (SQLite) ve
`shopify.app.toml` dosyası vardır, kök uygulamayla kod paylaşmaz.

## Üç repo birlikte çalışır

| Repo | Rol |
|---|---|
| `sugar-shopify/koshoy` (bu klasör) | Backend: sohbet turu, tasarım düzenleme, fiyat, sepet paketi |
| `pnp-shopify-project` | Frontend: Shopify teması, sohbet arayüzü, sepet sayfası |
| `3d-room-designer` | 3D motor: `<koshoy-cabin-view>` ve dolap çekirdeği (`src/core/cabinet`) |

- Tema bu app'e yalnızca App Proxy ile gelir: vitrinde `/apps/koshoy/studio/*` →
  `https://koshoy.sugartech.io/apps/koshoy/studio/*`.
- `app/koshoy/cabinet-core/` 3D repodaki `src/core/cabinet`'in kopyasıdır. Elle
  düzenlenmez: `npm run sync:cabinet-core` (kontrol: `-- --check`).
- Uç noktalar, olaylar ve hata kodları: `pnp-shopify-project/docs/koshoy-contract.md`.
  Yeni uç nokta ya da olay eklenince o belge de güncellenir.

## Akış

```
tema (sohbet) → /apps/koshoy/studio/turn → app/koshoy/turn.server.ts
  → LLM_GATEWAY_URL (tagservice /api/shopify/shopping/responses/stream, tag koshoy-chat)
  → server tool'ları: set_brief, ask_user, plan_cabinet, edit_design, quote, switch_design
  → beyaz liste olaylar (events.ts) → tema
```

Doğrudan Claude/OpenAI API'si kullanılmaz; LLM her zaman şirketin gateway'inden geçer.

## Değişmez kurallar

1. **Fiyat yalnız Shopify'dan gelir.** Dolabın parça listesi (`toBom`) Shopify ürün
   adlarıyla eşleşir (mağazada SKU yok): `Bakay WxHxD mm` gövde, `Acıbay` kapak,
   `Acıbay Çekmece` çekmece önü, `Sırgak` çekmece, `Tekçe` raf, `Tündük` taç,
   `Gardırop Askısı W`. Eşleşmeyen parçaya fiyat uydurulmaz, ekranda `[FİYAT]` görünür.
2. **Frontend'e backend izi gitmez.** Olaylar `events.ts` beyaz listesinden geçer;
   iç adlar, SKU'lar, hata ayrıntıları, sağlayıcı adları tarayıcıya yazılmaz.
3. **Sepet = bizim app'in oluşturduğu paket ürün** (`bundle.server.ts`):
   - Parça ürünleri vitrinde yayında değildir, paketin bileşenidir.
   - Paket adı mağaza içerik rehberine uyar: `[özellik] Tür Genişlik cm, Sayılı özellik – Renk`
     (ör. "Çekmeceli Gardırop 192 cm, 4 Kapaklı – Ahşap"). Bakay, Acıbay gibi iç adlar
     müşteriye görünen hiçbir metne girmez.
   - Paket fiyatını Shopify hesaplamaz, Σ parça fiyatını biz yazarız.
   - Durum `UNLISTED` + Online Store kanalı. 30 günden eski paketler silinir.
   - Paket resmi tarayıcının gönderdiği 3D görüntüdür (Shopify Files'ta durur).
   - Fiyat güncellerken `productVariantsBulkUpdate` kullan, `productSet` varyant
     kimliğini değiştirir ve paketleri kırar.
4. **Müşteriye giden metinlerde yasaklar** (`docs/magaza-icerik-rehberi.md`): gömme,
   garanti, kurulum, teslim süresi, E1, tedarikçi adları, ürün kodları.
5. **Şifre ve anahtarlar** `.env` ve Coolify'dadır; koda, loga, belgeye yazılmaz.

## Yeni özellik eklerken (giriş, hesap, kayıtlı tasarım, entegrasyon…)

Veritabanı, servis ya da dış entegrasyon gereken her iş **bu backend'de** yapılır;
ayrı bir backend ya da temadan doğrudan dış servis çağrısı açılmaz.

- **Uç nokta:** vitrinden `/apps/koshoy/<alan>/<ad>` (App Proxy). Route
  `app/routes/apps.koshoy.<alan>.<ad>.tsx`, imza `koshoyContextFromProxy` ile doğrulanır.
- **İş mantığı:** `app/koshoy/` altında, testli (`*.test.ts`).
- **Veri:** bu app'in Prisma şeması (`prisma/schema.prisma`) + migration. Müşteriye
  ait veri Koshoy oturumuna (`KoshoySession`) bağlanır.
- **Dış servisler** (kimlik sağlayıcı, ödeme, e-posta, LLM…) yalnız buradan çağrılır.
  Gizli anahtarlar `.env` / Coolify'da durur; temaya yalnız public değerler gider.
- **Tarayıcıya dönen veri** `events.ts` beyaz listesinden geçer; e-posta, kimlik,
  token gibi kişisel ya da iç bilgi geri yazılmaz, loglanmaz.
- **Sözleşme:** yeni uç nokta, olay ve hata kodu `pnp-shopify-project/docs/koshoy-contract.md`'ye
  eklenir; tema kodu ondan sonra yazılır.
- Shopify müşteri hesabıyla bağlamak gibi mağaza kararları Fatih'e sorulur.

## Çalıştırmak için gerekenler

| Gereken | Neden | Yoksa |
|---|---|---|
| Üç repo yan yana: `sugar-shopify`, `pnp-shopify-project`, `3d-room-designer` | Docker ortamı (`pnp-shopify-project/devenv`) 3D'yi ve dolap çekirdeğini `../../3d-room-designer`'dan, backend'i `../../sugar-shopify/koshoy`'dan alır | `docker compose up` kalkmaz |
| Node 22.12+, Docker, Shopify CLI | Build, test, tema ve app komutları | — |
| LLM gateway (`api.sugartech.io` → decor-ai) ve mağaza API anahtarı (`KOSHOY_DEV_SUGAR_API_KEY`) | Gerçek sohbet | `KOSHOY_CHAT_MOCK=1` ile örnek sohbet |
| Koshoy Studio app bilgileri (`.env`), mağazada personel erişimi, Dev Dashboard üyeliği | Gerçek Shopify fiyatı, sepet, app deploy | `KOSHOY_PRICE_MOCK=1` ile örnek fiyat |

- Temanın 3D dosyası (`pnp-shopify-project/assets/koshoy-studio-3d.js`) git'tedir;
  3D'ye dokunmayan biri `3d-room-designer`'ı build etmeden temayı çalıştırabilir.
- Coolify erişimi gerekmez: backend, izlenen dala push edilince kendiliğinden deploy olur.
- Şifre ve anahtarlar kimseye düz metin gönderilmez; ekip içinden şifreli kanalla istenir.

## Komutlar

```sh
npm test              # app/koshoy/*.test.ts
npm run typecheck
npm run sync:cabinet-core -- --check
```

Deploy: `.claude/skills/koshoy-deploy/SKILL.md` (push = Coolify deploy).

## Belgeler

- `docs/magaza-icerik-rehberi.md` — ürün/paket adı ve müşteri metni kuralları (CMO)
- `docs/devir-2026-10-07-shopify-uygulama-fatih-erol.md` — PnP-OS app'i ve Shopify API notları
- `pnp-shopify-project/docs/` — plan, çalıştırma kılavuzu, sözleşme
