# Koshoy veri API'si

Mağaza ekibi sohbetin verisini buradan değiştirir. Kod değişikliği gerekmez.
Veri Koshoy'un kendi veritabanında durur, Shopify'da değil.

## Temel kural

**Kaydedilmeyen veri sitedeki eski hâli bozmaz.**

- Her `PUT` önce kontrol edilir. Hata varsa hiçbir şey kaydedilmez.
- Hata listesi hangi satırın bozuk olduğunu söyler.
- Kayıtlı bir belge sonradan geçersiz kalırsa (kod değiştiyse) sitede
  kod içindeki hazır değer kullanılır. `audit` bunları listeler.
- Değişikliği sohbet en geç 1 dakikada görür.

## Adres ve anahtar

| | |
|---|---|
| Adres | `https://koshoy.sugartech.io/api/koshoy` |
| Anahtar | `Authorization: Bearer <anahtar>` başlığı |
| Anahtar nerede | Coolify'da `KOSHOY_DATA_API_KEY`. Ekipten şifreli kanalla istenir. |

Anahtar dosyaya, belgeye, mesaja yazılmaz.

## Belgeler

| Anahtar | Ne demek |
|---|---|
| `rooms` | Oda setleri: hangi odaya hangi ürünler önerilir |
| `kinds` | Ürün türleri: ad, eş anlamlılar, yan yana birleşme, sorular |
| `levels` | Bütçe seviyeleri: taç ve mat kapak kendiliğinden mi, sorularak mı |
| `scope` | Yapmadığımız ürünler ve hiç konuşulmayan konular |
| `texts` | Sabit müşteri metinleri |
| `images` | Bilgi resimleri (taç var/yok, kapak serisi, panel, kulp) |

`PUT` bütün belgeyi değiştirir. Önce `GET` ile al, değiştir, geri gönder.

### Ortak sınırlar

| Konu | Sınır |
|---|---|
| `id` | Küçük harf, rakam, `_`, `-`. Türkçe harf yok. En çok 40 karakter. |
| Belge boyu | En çok 64 KB |
| Bilinmeyen alan | Hata değil, atılır |
| Eksik alan | Hata |

### Ürün türleri (`kind`)

`gardirop`, `komodin`, `sifonyer`, `tv_unitesi`, `kitaplik`, `vestiyer`,
`kiler`, `ayakkabilik`, `banyo_dolabi`, `cok_amacli_dolap`

## rooms

| Alan | Kural |
|---|---|
| liste | 1–30 oda, `id` tekrar etmez |
| `items` | 1–6 ürün, her tür bir kez |
| `count` | 1–4 |

```json
[
  {
    "id": "salon",
    "label": "Salon",
    "synonyms": ["oturma odası"],
    "items": [
      { "kind": "tv_unitesi", "count": 1 },
      { "kind": "kitaplik", "count": 1 }
    ]
  }
]
```

## kinds

| Alan | Kural |
|---|---|
| `kind` | Listede en çok bir kez |
| `joinSameKind` | `true`: aynı türden birkaç tane yan yana tek parça durur |
| `questions` | En çok 6 soru |
| `level` | `room`: dış ölçüyü değiştirir, oda onayından önce sorulur. `product`: iç düzen, ürün ürün onayda sorulur. |
| `options` | 2–4 seçenek |
| `hint` | Asistana kısa talimat, müşteri görmez. En çok 120 karakter. |

```json
[
  {
    "kind": "ayakkabilik",
    "label": "Ayakkabılık",
    "synonyms": ["ayakkabı dolabı"],
    "joinSameKind": false,
    "questions": [
      {
        "id": "kutu",
        "level": "product",
        "question": "Ayakkabılar kutuda mı duruyor?",
        "options": [
          { "id": "kutuda", "label": "Kutuda", "hint": "derinlik 48 cm" },
          { "id": "kutusuz", "label": "Kutusuz", "hint": "derinlik 32 cm" }
        ]
      }
    ]
  }
]
```

## levels

| Alan | Kural |
|---|---|
| liste | 1–4 seviye |
| `label` | İçinde "ucuz", "hesaplı" geçemez |
| `crown` | Uzun gövdede taç. `auto`: kendiliğinden gelir, müşteriye söylenir. `ask`: iki toplam fiyatla sorulur. |
| `front` | Mat kapak serisi (Aruuke). `auto` / `ask` aynı anlamda. |

```json
[
  { "id": "en_iyisi", "label": "En iyisi olsun", "crown": "auto", "front": "auto" },
  { "id": "fiyatina_bakarak", "label": "Fiyatına bakarak seçeyim", "crown": "ask", "front": "ask" }
]
```

## scope

İki liste, her biri en çok 50 metin.

```json
{
  "outOfScope": ["tezgahlı mutfak alt dolabı", "koltuk", "kanepe"],
  "unsaid": ["nem dayanımı"]
}
```

## texts

İki metin, her biri 1–300 karakter.

```json
{
  "customMadeWarning": "Bu ürünler yalnız senin için tasarlanan özel üretimdir.",
  "promiseLine": "Bunlar adresini aldığımızda netleşir; sepette göreceksin."
}
```

## images

| Alan | Kural |
|---|---|
| liste | En çok 200 resim, aynı `kind` + `option` bir kez |
| `kind` | Bir tür ya da `*` (bütün türler) |
| `option` | `crown_on`, `crown_off`, `front_<seri>` (ör. `front_kapak-18`), `panel_<ad>`, `handle_<ad>` |
| `url` | Yalnız `https://image-s3.sm.mncdn.com/...` |

```json
[
  { "kind": "*", "option": "crown_on", "url": "https://image-s3.sm.mncdn.com/koshoy/tac-var.jpg" },
  { "kind": "gardirop", "option": "front_kapak-18", "url": "https://image-s3.sm.mncdn.com/koshoy/mat-kapak.jpg" }
]
```

## curl örnekleri

```sh
export KOSHOY_KEY='...'   # ekipten şifreli kanalla gelir
API=https://koshoy.sugartech.io/api/koshoy
AUTH="Authorization: Bearer $KOSHOY_KEY"

# Bütün belgeler (version, source, value)
curl -s -H "$AUTH" $API/data

# Tek belge
curl -s -H "$AUTH" $API/data/rooms

# Yalnız kontrol, kaydetmez
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  --data @rooms.json $API/data/rooms/validate

# Kaydet
curl -s -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  --data @rooms.json $API/data/rooms

# Eski sürümler (en yeni önce, en çok 50)
curl -s -H "$AUTH" $API/data/rooms/history

# Kayıtlı ama artık geçersiz belgeler
curl -s -H "$AUTH" $API/data/audit

# Huni (from ve to dahil, Türkiye saati)
curl -s -H "$AUTH" "$API/funnel?from=2026-10-01&to=2026-10-28"
```

`rooms.json` yalnız belgenin kendisidir (`value`), `version` ve `source` yazılmaz.

## Cevaplar

| Kod | Anlam |
|---|---|
| 200 | Tamam. `PUT`: `{ "ok": true, "version": 3 }` |
| 400 | Gövde JSON değil ya da tarih biçimi yanlış |
| 401 | Anahtar eksik ya da yanlış |
| 404 | Böyle bir belge ya da adres yok |
| 405 | Bu adres bu yöntemi kabul etmez |
| 413 | Gövde 64 KB'tan büyük |
| 422 | Belge geçersiz, hiçbir şey kaydedilmedi: `{ "ok": false, "errors": [...] }` |
| 503 | API kapalı (sunucuda anahtar tanımlı değil) |

`source` alanı:

| Değer | Anlam |
|---|---|
| `db` | Kaydedilen belge sitede kullanılıyor |
| `default` | Kod içindeki hazır değer kullanılıyor (hiç kaydedilmedi ya da kayıt artık geçersiz) |

## Huni (funnel)

Her adım için o günlerde adıma ulaşan oturum sayısı.

| Alan | Anlam |
|---|---|
| `sessions` | Adıma ulaşan farklı oturum |
| `phone` / `desktop` | Cihaza göre (tablet = phone). Bir oturum ikisinde de olabilir (QR ile telefon). |
| `rateFromPrevious` | Bir önceki adıma oran. `0.42` = %42. İlk adımda ve önceki 0 ise `null`. |
| `truncated` | `true`: çok satır var, sayılar eksik |

| Adım | Ne oldu |
|---|---|
| `card_clicked` | Vitrindeki karta tıkladı |
| `first_message` | İlk mesajı yazdı |
| `room_chosen` | Oda seçti |
| `structure_photo` / `structure_measure` / `structure_skipped` | Oda yapısı: fotoğraf / ölçü / atladı |
| `set_planned` | Set planlandı |
| `style_done` | Stil seçildi |
| `signed_in` | Giriş yaptı |
| `room_approved` | Odayı onayladı |
| `product_approved` / `product_changed` / `product_later` / `product_removed` | Ürün: onay / değişiklik / sonra / çıkarıldı |
| `cart_sent` | Sepete gönderdi |
| `checkout_started` | Ödemeye geçti |
| `order_placed` | Sipariş verdi |

Olaylarda kişisel veri tutulmaz. 180 günden eski olaylar silinir.
