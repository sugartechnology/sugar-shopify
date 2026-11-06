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
| `colors` | Mağaza renklerinin görünüşü: müşteri adı ve renk kodu |

`PUT` bütün belgeyi değiştirir. Önce `GET` ile al, değiştir, geri gönder.

### Ortak sınırlar

| Konu | Sınır |
|---|---|
| `id` | Küçük harf, rakam, `_`, `-`. Türkçe harf yok. En çok 40 karakter. |
| Belge boyu | En çok 64 KB |
| Bilinmeyen alan | Hata değil, atılır |
| Eksik alan | Hata |

### Ürün kimlikleri (`kind`)

`kinds` belgesindeki her ürünün `kind` değeri. Başlangıçta yapım kalıplarının adları
(`gardirop`, `komodin`, `sifonyer`, `tv_unitesi`, `kitaplik`, `vestiyer`, `kiler`,
`ayakkabilik`, `banyo_dolabi`, `cok_amacli_dolap`) ve `keson`, `dresuar`; Akın ekledikçe artar.

## rooms

| Alan | Kural |
|---|---|
| liste | 1–30 oda, `id` tekrar etmez |
| `items` | 1–6 ürün, her ürün bir kez; `kind` = `kinds` belgesindeki ürün kimliği (listede yoksa "Dolap" kurulur) |
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

Her ürün bir satırdır (ClickUp z8qu5d3qan). Yeni ürün eklemek veri girişidir, kod değişikliği değil.
Kodda yalnız **yapım kalıpları** kalır: `gardirop`, `komodin`, `sifonyer`, `tv_unitesi`, `kitaplik`,
`vestiyer`, `kiler`, `ayakkabilik`, `banyo_dolabi`, `cok_amacli_dolap` (gövde, çekmece, raf, askı nasıl kurulur).

| Alan | Kural |
|---|---|
| `kind` | Ürünün kimliği (küçük harf, Türkçe harfsiz). **Hiç değişmez**; adı değiştirmek için `label` değişir. Listede bir kez; en çok 60 ürün |
| `template` | Hangi yapım kalıbıyla kurulduğu (yukarıdaki 10'dan biri). Kalıp satırlarında (`kind` kalıp adıysa) yazılmaz |
| `label` | Müşteriye görünen ad; sekmede, sohbette, sepette ve siparişte görünür. Yeni ürünlerde yalnız harf ve boşluk, en çok 30 |
| `synonyms` | Müşterinin kullandığı başka sözcükler |
| `joinSameKind` | `true`: bu üründen birkaç tane yan yana tek parça durur (kitaplık). Yazılmazsa `false` |
| `questions` | En çok 6 soru (aşağıda) |
| `unitWidthsMm` | Bu ürünün tek gövdesinin olabileceği genişlikler (mm). Yazılmazsa kalıbın kuralı. 320 ve 480 her zaman olmalı; kalıbın izin verdiğinden genişi olamaz (kitaplık en çok 640: raf sarkar). Toplam genişlik önce en genişiyle doldurulur: 192 cm kitaplık = 64 + 64 + 64 |
| `build` | İsteğe bağlı: ürünün kendi ölçüsü ve içi. Yoksa kalıbın ölçüsü ve seviyeleri kullanılır |
| `build.widthMm` / `heightMm` / `depthMm` | Varsayılan dış ölçü (mm); yükseklik ve derinlik katalog ölçüsü olmalı |
| `build.fittings` | Her gövdenin içi, alttan üste: `drawer160` (küçük çekmece), `drawer320` (büyük çekmece), `shelf`, `hanger` |
| `build.door` | Çekmecelerin üstündeki alana kapak |
| `note` | Asistana kısa not (ör. "tekerleği yok"), en çok 160 |

Sorular:

| Alan | Kural |
|---|---|
| `level` | `room`: dış ölçüyü değiştirir, oda onayından önce sorulur. `product`: iç düzen, ürün ürün onayda sorulur. |
| `options` | 2–4 seçenek |
| `hint` | Asistana kısa talimat, müşteri görmez. En çok 120 karakter. |

Her ürün kaydedilmeden önce kurulur: iç düzen sığmazsa, kapak katalog ölçüsüne oturmazsa ya da
gövdeler izinli genişliklere bölünemezse belge kaydedilmez, hata satır satır söylenir; site eski
hâliyle çalışmaya devam eder.

Silinen bir ürün: o ürünle kaydedilmiş tasarımlar kalıbının kuralıyla açılmaya devam eder; bir oda
setinde (`rooms.items`) adı kalırsa "Dolap" olarak kurulur. Kimlik silmek yerine ürünü listeden
çıkarmak yeterlidir.

Eski biçim (5 Kasım'a kadar): kalıp satırının altındaki `products` listesi hâlâ okunur; her biri
kendi satırı olur.

```json
[
  {
    "kind": "kitaplik",
    "label": "Kitaplık",
    "synonyms": [],
    "joinSameKind": true,
    "unitWidthsMm": [320, 480, 640],
    "questions": [
      {
        "id": "raf_icerigi",
        "level": "product",
        "question": "Raflarda çoğunlukla ne duracak?",
        "options": [
          { "id": "kitap", "label": "Kitap", "hint": "raf aralığı sık" },
          { "id": "kutu_dekor", "label": "Kutu ve dekor", "hint": "raf aralığı geniş" }
        ]
      }
    ]
  },
  {
    "kind": "keson",
    "template": "komodin",
    "label": "Keson",
    "synonyms": ["masa altı çekmece"],
    "build": {
      "widthMm": 480, "heightMm": 544, "depthMm": 480,
      "fittings": ["drawer160", "drawer160", "drawer160"],
      "door": false
    },
    "note": "Masa altına ya da yanına giren çekmeceli dolap; tekerleği yok, bazalı."
  }
]
```

## levels

| Alan | Kural |
|---|---|
| liste | 1–4 seviye |
| `label` | Müşterinin tıkladığı seçenek. İçinde "ucuz", "hesaplı" geçemez |
| `name` | İsteğe bağlı kısa ad; oda özetinde "Bütçe: …" satırında görünür. Yoksa `label` kullanılır |
| `crown` | Uzun gövdede taç. `auto`: kendiliğinden gelir, müşteriye söylenir. `ask`: iki toplam fiyatla sorulur. |
| `front` | Mat kapak serisi (Aruuke). `auto` / `ask` aynı anlamda. |

```json
[
  { "id": "en_iyisi", "label": "En iyisi olsun", "name": "En iyisi", "crown": "auto", "front": "auto" },
  { "id": "fiyatina_bakarak", "label": "Fiyatına bakarak seçeyim", "name": "Fiyata göre", "crown": "ask", "front": "ask" }
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
| `kind` | Bir ürün kimliği ya da `*` (bütün ürünler) |
| `option` | `crown_on`, `crown_off`, `front_<seri>` (ör. `front_kapak-18`), `panel_<ad>`, `handle_<ad>` |
| `url` | Yalnız `https://image-s3.sm.mncdn.com/...` |

```json
[
  { "kind": "*", "option": "crown_on", "url": "https://image-s3.sm.mncdn.com/koshoy/tac-var.jpg" },
  { "kind": "gardirop", "option": "front_kapak-18", "url": "https://image-s3.sm.mncdn.com/koshoy/mat-kapak.jpg" }
]
```

## colors

Stüdyonun renkleri mağazanın renkleridir. Bu belge her rengin görünüşünü verir; hangi
rengin müşteriye sunulacağını mağaza belirler:

- **Dolap rengi** (`"use": "body"`): şablonların bütün parçaları mağazada bu renkte varsa sunulur.
  İlk sıradaki sunulan renk varsayılandır. Eski tasarımların rengi (Ahşap, Kırık beyaz, Mavi) ona düşer.
- **Kulp rengi** (`"use": "handle"`): mağazada bu renkte bir `Serek Kulp` ürünü varsa sunulur. Hiç kulp
  ürünü yoksa kulp sorulmaz, tasarımlarda kulp olmaz.
- Mağazada olup burada görünüşü olmayan renk stüdyoda çıkmaz. Admin sayfası → Katalog sağlığı bunu gösterir.
- Değişiklik en geç 5 dakikada (bir sonraki katalog okumasında) stüdyoya yansır.

| Alan | Kural |
|---|---|
| liste | 1–30 renk, en az biri `"use": "body"`, aynı renk bir kez |
| `shopColor` | Ürün adındaki renk, ör. `LAKE BEYAZ`, `KUMTAŞI`, `SİYAH` (büyük/küçük harf önemsiz) |
| `label` | Müşterinin gördüğü ad, 1–40 karakter |
| `css` | `#rrggbb` renk kodu (stüdyo ve 3D çizimi) |
| `use` | `body` (dolap) ya da `handle` (kulp) |

```json
[
  { "shopColor": "LAKE BEYAZ", "label": "Lake beyaz", "css": "#f1eee7", "use": "body" },
  { "shopColor": "KUMTAŞI", "label": "Kumtaşı", "css": "#d6cab6", "use": "body" },
  { "shopColor": "SİYAH", "label": "Siyah", "css": "#2b2b2b", "use": "handle" },
  { "shopColor": "BEYAZ", "label": "Beyaz", "css": "#f5f5f3", "use": "handle" }
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
