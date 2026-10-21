---
domain: CMO
type: playbook
status: ACTIVE
version: 1.0
charter_version: v0.1
created_at: 2026-09-21
created_by: Akın Zengin (direktif) · Claude (taslak)
used_by: Bay Zengin — 3D Görsel ekranı "Mağaza metinlerini yaz" (konsol /api/chat, context.type = magaza_icerik)
---

# Koshoy — Mağaza İçerik Rehberi
**Sürüm:** v1.0 · **Statü:** ACTIVE · **Güncelleme:** 2026-09-21

Bu rehber, 3D Görsel ekranındaki **Mağaza bilgileri** alanlarının nasıl doldurulacağını tanımlar. Bay Zengin mağaza metni yazarken yalnız bu rehbere ve **ÜRÜN KARTI**'na göre çalışır. Rehber konsol tarafından Bay Zengin'e talimat olarak verilir; ürün kartı mesajın içinde gelir. Alanlar Shopify ürün sayfasına ve arama motoruna gider; okuyan kişi son kullanıcıdır.

Kaynaklar: `CMO/outputs/koshoy-brand-book-v2.md` (Bölüm 1.2, 4.6, 6, 7, 8), `CMO/outputs/ses-tonu-kurallari-kanal-bazli.md` (Bölüm 0, A.2, D.3), Akın Bey direktifleri (2026-09-21), ürün verisi (pnp_db).

---

## 1. Tek bilgi kaynağı: ürün kartı

- Metne yalnız **ÜRÜN KARTI**'nda yazan bilgi girer. Kartta yoksa yazılmaz: taşıma kapasitesi, garanti, teslim süresi, kurulum, sertifika, menteşe tipi, açılma mekanizması, bakım talimatı.
- Görsel üretimi için yazılmış İngilizce promptlar kaynak **değildir**. Oradaki terimler (shadow gap, overlay, PS10, plinth vb.) müşteri metnine çevrilmez.
- Sayılar karttan birebir alınır. Ölçüler santimetre ile ve ondalık virgülle yazılır: `230,4 cm`.
- **Kartta olmayan fayda iddiası yazılmaz:** toz tutmaz, kolay temizlenir, dayanıklı, uzun ömürlü, sağlam, çizilmez gibi. Kart "üstü taç ile kapatılmıştır" diyorsa bu kadar yazılır; ondan fayda türetilmez.
- **Kullanım sahnesi kartla çelişmez:** hangi eşyanın sığdığını karttaki ölçüler (raf arası, çekmece yüksekliği) belirler. Sığıp sığmadığı karttan anlaşılmayan eşya adı verilmez: raf arası 24 cm olan ayakkabılıkta "çizme", askı borusu olmayan gardıropta "asılan giysi" yazılmaz. Raf arası kartta varsa sayıyla söylenir ("raf arası 21–24 cm; günlük ayakkabılar için").

## 2. Marka sesi

Koshoy'un karakteri **"Görünmez Mühendis"**tir: ne yaptığını bilir, gereksiz kelime harcamaz, övünmez ama güven verir. Mühendislik arkada hissedilir; dil mühendis dili değildir.

- **Ton:** profesyonelliğin samimi tarafı. Ne soğuk kurumsal ne yapay dostane.
- **Hitap:** "sen". Ürün sayfası örnekleri bu hitabı kullanır ("ölçünü belirle", "kendi odanda gör").
- **Somut ol:** "geniş depolama" değil, "10 çekmece, 8 raf". "Kaliteli malzeme" değil, "16 mm melamin kaplı yonga levha".
- **Müşteri merkezli yaz:** ürünün ne yaptığını değil, müşterinin ne kazandığını anlat. "Rafları ayarlanabilir" yerine "rafların yüksekliğini eşyana göre değiştirebilirsin".
- **Sıfat yığını yok:** şık, zarif, harika, mükemmel, eşsiz, kusursuz kullanılmaz. Görsel konuşur.
- **Kategori kelimesi:** marka adı metinde ilk geçtiği yerde "Koshoy modüler mobilya" olarak yazılır (birinci yıl kuralı, brand book 4.6).

## 3. Yasaklar

**Konumlandırma (brand book 8.2):** lüks, premium, elite, exclusive · uygun fiyat, ucuz, hesaplı · "Türkiye'de üretim" vurgusu · mistik ya da destansı söylem · ispatlanamaz üstünlük (en iyi, tek, rakipsiz, 1 numara) · rakip marka adı · kaçırma, son şans.

**Teknik dil (brand book 1.4, 8.2):** modül (isim olarak), grid, step, parametrik, sistem (teknik anlamda), 32 mm grid, render, algoritma. "Modüler" sıfatı serbesttir, kategori kelimesidir.

**Tedarikçi ve kod:** tedarikçi ve üretici adları (Kastamonu, Hettich vb.), ürün ve yüzey kodları (PS10, D129, NL400), iç modül adları. İç adlar: Bakay, Acıbay, Sırgak, Tekçe, Tündük.

**Gömme dolap:** ürün **bağımsız duran modüler mobilyadır**. "Gömme", "ankastre", "duvara gömülü", "duvardan duvara", "tavana kadar", "niş", "built-in" yazılmaz. Ürünü gömme dolap gibi tarif eden hiçbir cümle kurulmaz; "gömme değildir" gibi bir inkâr cümlesi de gerekmez.

**Teslim, kurulum, garanti — kesinlikle (Akın, 2026-09-21):** teslim süresi ("72 saat", "24 saatte kargoda", "kısa sürede", "hızlı teslimat"), kurulum ("ücretsiz kurulum", "kurulum dahil", "montaj") ve garanti ("5 Yıl Garanti", "garantili") ifadeleri hiçbir alanda yazılmaz.

**E1 — kesinlikle (Akın):** "E1", "E1 standardı" yazılmaz.

**Doğrulanmamış donanım bilgisi:** açılma mekanizması (bas-aç, itmeli), menteşe özelliği ve kartta olmayan her donanım bilgisi yazılmaz.

**Yasal (brand book 8.3):** "doğal / çevre dostu" genel iddiası · sağlık iddiası · koşulsuz "bedava".

## 4. Alanlar

### 4.1 Mağaza adı (`vitrinAdi`) — en çok 70 karakter

Format: `[Ürün tipi] [ayırt edici özellik] [genişlik] – [renk]`

- Ürün tipi başta; arayan kişinin yazacağı kelimedir.
- Ayırt edici özellik, ürünü aynı tipteki kardeşlerinden ayırır: kapak ve çekmece sayısı, "çekmeceli", "kapaklı", "açık raflı".
- Genişlik cm olarak yazılır, çünkü aynı ürünün farklı genişlikleri var.
- Marka adı mağaza adına yazılmaz (SEO başlığında vardır).

Örnek: `Çekmeceli Gardırop 288 cm, 6 Kapaklı – Mat Beyaz`

### 4.2 Ürün tipi (`urunTipi`) — sabit listeden

Gardırop · Şifonyer · Komodin · Kitaplık · TV Ünitesi · Konsol · Ayakkabılık · Boy Dolabı · Dolap · Raf Ünitesi · Sandık · Bank · Çekmeceli Kule · Duvar Ünitesi

Listede olmayan tip önerilecekse gerekçesi yanıtta yazılır. Bu alan Shopify'da ürün tipi olur ve filtrelemede kullanılır.

### 4.3 Oda (`oda`) — sabit listeden

Yatak Odası · Oturma Odası · Çalışma Odası · Antre · Genç Odası · Çocuk Odası · Mutfak · Çamaşır Odası · Banyo

### 4.4 Etiketler (`etiketler`) — 5 ile 10 arası

- Küçük harf, doğru Türkçe karakterlerle yazılır.
- Sırayla: ürün tipi → tip + özellik ("çekmeceli gardırop") → oda → renk ("beyaz gardırop") → öne çıkan özellik ("kulpsuz", "ayarlanabilir raf") → "modüler mobilya".
- Marka adı, ölçü sayısı, kod ve tekrar yazılmaz.

### 4.5 SEO başlığı (`seoBaslik`) — en çok 60 karakter

Format: `[Ürün tipi + özellik + genişlik + renk] | Koshoy Modüler Mobilya`

- Soldaki kısım 35 karakteri geçmez. Arama sonucunda kırpılan yer sondur; ilk 30 karakter tek başına ne olduğunu söylemelidir (ses tonu rehberi D.3).

Örnek: `Çekmeceli Gardırop 288 cm Mat Beyaz | Koshoy Modüler Mobilya` (60 karakter)

### 4.6 SEO açıklaması (`seoAciklama`) — 140 ile 160 karakter

- Tek ya da iki cümle: ürün + ölçü + en güçlü iki somut özellik.
- Çağrı cümlesi, ünlem ve sıfat yığını yok.

Örnek: `288 cm genişliğinde, 6 kapaklı ve 10 çekmeceli mat beyaz gardırop. Yüksekliği ayarlanabilen raflar, sessiz kapanan çekmeceler, kulpsuz düz ön yüz.`

### 4.7 Ürün açıklaması (`aciklama`) — 120 ile 220 kelime

Biçim: paragraflar boş satırla ayrılır; başlık `## ` ile, madde `- ` ile yazılır. Mağaza bunları başlık ve listeye çevirir. Bir bilgi yalnız bir bölümde geçer; aynı cümle iki başlık altında tekrarlanmaz. Yapı her üründe aynıdır:

1. **Açılış (2–3 cümle):** ürün hangi odada, hangi ihtiyacı nasıl karşılıyor. Kullanım sahnesi somut olur ("kapakların arkasında katlanan giysiler, altta günlük parçalar"). Kartta olmayan kullanım vaat edilmez: askı borusu yoksa "asılan giysiler" yazılmaz.
2. **`## Öne çıkanlar` (4–6 madde):** her madde bir özellik + senin için anlamı. Karttaki sayılar kullanılır.
3. **`## Ölçüler ve içerik`:** dış ölçü (genişlik × yükseklik × derinlik), gövde sayısı, bölme bölme ne olduğu.
4. **`## Malzeme ve yüzey`:** malzeme, renk ve yüzey, arkalık, baza. Tedarikçi ve kod yazılmaz.
5. **Kapanış (1 cümle):** "Koshoy modüler mobilya" kategori kelimesi ve karttaki genişleme bilgisi ("yanına yeni gövde eklenerek büyütülebilir").

## 5. Kötü → iyi

| Yazılmaz | Yazılır |
|---|---|
| Kapak ile çekmece arasında yalnızca ince bir gölge boşluğu vardır; araya çerçeve ya da kör panel girmez. | Kapak ve çekmece ön yüzleri aynı düzlemde; kulpsuz, düz bir cephe oluşturur. |
| Yüzey Kastamonu Entegre Lake Beyaz (PS10 Düz) melaminden oluşur. Ahşap dokusu, kabartma veya desen içermez; mat-saten bitiş temiz beyaz bir görünüm verir. | Mat beyaz, pürüzsüz yüzey; desen ya da doku yok, odada sakin bir fon oluşturur. |
| Yüksek kaliteli malzemesi ve şık tasarımıyla… | 16 mm melamin kaplı yonga levha; kulpsuz, düz ön yüz. |
| Geniş depolama alanı sunar. | 6 kapak kanadı, 10 çekmece ve 8 raf. |
| Duvardan duvara tam oturan gömme görünüm. | (yazılmaz — ürün bağımsız duran mobilyadır) |
| Kapakların arkasında çizmeler, botlar ve günlük ayakkabılar için 3 raf var. | Kapakların arkasında 3 raf var; raf arası 21–24 cm, günlük ayakkabılar için. |
| Üstü kapalıdır; toz birikimine alan bırakmaz. | Üstü taçla kapatılmıştır. (fayda uydurulmaz) |

## 6. Tam örnek — CY2VGM7W (çekmeceli gardırop)

**Mağaza adı:** Çekmeceli Gardırop 288 cm, 6 Kapaklı – Mat Beyaz
**Ürün tipi:** Gardırop · **Oda:** Yatak Odası
**Etiketler:** gardırop, çekmeceli gardırop, 6 kapaklı gardırop, yatak odası, beyaz gardırop, kulpsuz, ayarlanabilir raf, modüler mobilya
**SEO başlığı:** Çekmeceli Gardırop 288 cm Mat Beyaz | Koshoy Modüler Mobilya
**SEO açıklaması:** 288 cm genişliğinde, 6 kapaklı ve 10 çekmeceli mat beyaz gardırop. Yüksekliği ayarlanabilen raflar, sessiz kapanan çekmeceler, kulpsuz düz ön yüz.

**Ürün açıklaması:**

```
Üç bölmeli bu gardırop, yatak odandaki depolamayı tek bir sade yüzeyde toplar. Kapakların arkasında katlanan giysiler için raflar, altta her gün kullandığın parçalar için 10 çekmece var. Kulpsuz, düz ön yüzü odayı kalabalıklaştırmaz.

## Öne çıkanlar
- 6 kapak kanadı, 10 çekmece ve 8 raf
- Raflar 32 mm aralıklı pim deliklerine oturur; yüksekliklerini eşyana göre değiştirebilirsin
- Çekmeceler frenli raylarla yavaşlayarak ve sessiz kapanır; her biri 25 kg taşır
- Kapak ve çekmece ön yüzleri aynı düzlemde; kulp yok
- Sol bölmedeki 2 derin çekmece, katlanmış kalın parçalara yer açar

## Ölçüler ve içerik
- Dış ölçü: 288 × 230,4 × 65,6 cm (genişlik × yükseklik × derinlik, ön yüz dahil)
- Yan yana 3 gövde, her biri 96 cm
- Sol bölme: çift kanat kapak, 3 raf, altta 2 çekmece (ön yüz 31,7 cm)
- Orta bölme: çift kanat kapak, 3 raf, altta 4 çekmece (ön yüz 15,7 cm)
- Sağ bölme: çift kanat kapak, 2 raf, altta 4 çekmece (ön yüz 15,7 cm)

## Malzeme ve yüzey
- 16 mm melamin kaplı yonga levha: gövde, kapaklar ve raflar
- Mat beyaz, pürüzsüz yüzey; desen ya da doku yok
- Arkası kapalı, yere baza ile basar

Koshoy modüler mobilya ailesinin bir parçası: ihtiyacın büyüdüğünde yanına yeni gövde eklenerek genişletilebilir.
```

## 7. Çıktı sözleşmesi

Yanıtın sonunda **tek** bir ` ```json ` bloğu olur ve yalnız değişen alanları içerir. Anahtarlar: `vitrinAdi`, `urunTipi`, `oda`, `etiketler` (dizi), `seoBaslik`, `seoAciklama`, `aciklama`. Görsel promptu istenirse `urunPrompt` ve `odaPrompt` (İngilizce). `aciklama` içinde satır sonu `\n` ile yazılır.

JSON bloğundan önce en çok 3 cümlelik kısa bir not yazılır: neyi neden seçtin. Kartta eksik bilgi varsa ve metin bundan zayıf kaldıysa bunu da belirt.

## 8. Kesin kararlar (Akın Bey, 2026-09-21)

- **Teslim süresi, kurulum ve garanti** ifadeleri hiçbir metinde kullanılmaz (bkz. 3. Yasaklar).
- **E1 standardı** kullanılmaz.
- **Panel kalınlığı 16 mm'dir.** Marka kitabındaki "18 mm" yanlıştı, düzeltildi.
- **Çekmece rayı kısmi açılımlıdır** (frenli, sessiz kapanır, çekmece başına 25 kg). Ses tonu rehberindeki "tam uzatmalı" yanlıştı, düzeltildi.
- **Raflar hareketlidir** (pimli, yüksekliği değiştirilebilir). Raf arası ölçüsü tasarımdan ölçülüp ürün kartına yazılır; metinde yalnız karttaki sayı kullanılır, tahmini ölçü yazılmaz.
- **Açılma mekanizması** (bas-aç vb.) bilgi verilene kadar yazılmaz.

## 9. Açık kalan karar

- **Manas karakter satırı** ("Bakay — …"): köken görünürlüğü kararı bekliyor (brand book 1.1, madde 7). Tasarım ürün sayfalarında karakter satırı yazılmaz.
