# Shopify Uygulama Bağlantısı — Devir ve Kurulum Belgesi

**Hazırlayan:** Bay Zengin (Akın adına) · **Tarih:** 2026-10-07 · **Alıcı:** Fatih Erol

**Amaç:** Canlı bir Shopify mağazasını kod üzerinden (API ile) yönetebilen bir uygulamayı sıfırdan kurmak; ayrıca Koshoy'da çalışan "PnP-OS Entegrasyon" uygulamasının yapısını ve devir seçeneklerini aktarmak.

---

## 0. Bu belge nasıl okunur

Belge iki işi birlikte anlatır:

| Bölüm | Kime |
|-------|------|
| **A kısmı** (§1–§10) | Fatih kendi uygulamasını sıfırdan kuracaksa — tarif |
| **B kısmı** (§11) | Koshoy'daki mevcut uygulamayı kullanacaksa — devir seçenekleri |
| **C kısmı** (§12–§14) | Her iki durumda da gerekli: tuzaklar, doğrulama, kaynak dosyalar |

İşaretleme kuralı: belgedeki her teknik iddia ya bu oturumda **koşularak doğrulandı** (✓ işareti), ya da kaynağı belirtildi. Doğrulanmamış bir şey varsa açıkça "doğrulanmadı" yazar.

---

# A KISMI — Sıfırdan kurulum

## 1. Özet: çözülen sorun

**Ne işe yarar:** Shopify mağazasını panelden elle değil, kod/komut satırından yönetmeyi sağlar — ürün açma, fiyat güncelleme, stok, sipariş okuma, paket (bundle) kurma.

Koshoy tarafında bu yolla yapılanlar (ölçek örneği olsun diye):

- 252 mamul ürün olarak açıldı ve fiyatları merkezi bir veritabanı fonksiyonundan güncelleniyor
- Satış paketleri (bundle) API'den kuruldu, bileşenleri okunuyor
- Shopify yönetim paneline üç adet kendi yazdığımız arayüz eklentisi yerleşti
- Müşteri tarafı için Storefront API bağlandı (sepet açma → Shopify ödeme sayfası)

Teknik çerçeve: **Shopify Admin GraphQL API, sürüm 2026-07**.

## 2. Önce bilinmesi gereken: MCP sunucuları mağaza yönetmez

**Ne işe yarar:** Yanlış araçla başlamayı önler. Bu bizim ilk yarım günümüzü aldı.

Shopify'ın resmi MCP sunucuları var, ama **hiçbiri mağaza yönetimi için değil**:

| MCP | Ne yapar | Mağaza yönetir mi |
|-----|----------|-------------------|
| **Dev MCP** (`@shopify/dev-mcp`) | Shopify dokümanını arar, GraphQL sorgusunu/şemayı doğrular | Hayır |
| **Storefront MCP** | Müşteri tarafı katalog/sepet | Hayır (yönetim yok) |
| **Customer Accounts MCP** | Müşteri hesabı işlemleri | Hayır |

**Yönetim yalnız iki yolla olur: Admin API ya da Shopify CLI.**

Dev MCP yine de çok işe yarar (sorgu doğrulama, doküman arama). Kurulumu:

```bash
# ÖNEMLİ: npx ile çalıştırma — ilk indirme 30 saniyeyi aşıp MCP el sıkışması
# zaman aşımına düşüyor. Genel (global) kurulum yap.
npm install -g @shopify/dev-mcp
which shopify-dev-mcp   # -> /usr/bin/shopify-dev-mcp
```

Bizdeki kurulu sürüm: `@shopify/dev-mcp@1.15.4` ✓ (koşularak doğrulandı). MCP istemci yapılandırmasında komut olarak `npx` değil doğrudan `shopify-dev-mcp` yazılır.

## 3. Uygulama kurulumu (Dev Dashboard)

**Ne işe yarar:** API'ye bağlanmak için bir "uygulama" kimliği üretir. Mağazaya bu uygulama kurulur, erişim onun üzerinden olur.

### 3.1 Eski yöntem artık yok

İnternetteki çoğu doküman şunu anlatır: *mağaza panelinde Ayarlar → Uygulamalar → "Uygulama geliştir" → kalıcı `shpat_...` belirteci al.* **Bu akış bizim mağazada yok.** Shopify kullanıcıyı **Dev Dashboard**'a yönlendiriyor. Kalıcı `shpat_` belirteci üretilemiyor; yerine 24 saatlik belirteç geliyor (§4).

Beklenti yönetimi: "neden kalıcı anahtar bulamıyorum" diye aramakla zaman kaybetme.

### 3.2 Adımlar

1. **Dev Dashboard'a gir.** Shopify hesabıyla açılır; bir *organizasyon* altında çalışır. (Bizim organizasyon numarası: `228149843`.)
2. **Yeni uygulama oluştur.** Ada dikkat: müşteri görmez, iç ad. Bizimki `PnP-OS Entegrasyon`, uygulama numarası `425762422785`.
3. **Yetkileri (scopes) seç.** Hangi yetkiler gerekiyorsa işaretle (§7'deki liste bizim seçimimiz).
4. **Uygulamayı mağazaya kur.** Dev Dashboard bir kurulum (OAuth) bağlantısı verir; bu bağlantıya tıklayıp mağazayı seçmek ve yetkileri onaylamak gerekir. **Bu adımı insan yapar** — yetki onayını bir ajan/bot yerine mağaza sahibi tıklar.
5. **Gizli anahtarı (client secret) al.** Dev Dashboard'da bir kez gösterilir; hemen güvenli bir yere kaydet. Kaybolursa yeniden üretilir (eski geçersiz olur).
6. **client_id'yi al.** Gizli değildir, yapılandırma dosyasına yazılabilir. Bizimki: `5d7b975483cc5fc22d1843bb8ce2155a`.

### 3.3 Yetki değişikliği nasıl yapılır

Yetki eklemek/çıkarmak için Dev Dashboard'da **yeni sürüm yayınlamak** gerekir (sürüm = yapılandırmanın donmuş hali). Ardından belirteç yenilenmeli, yoksa eski yetkilerle çalışmaya devam eder.

## 4. Kimlik doğrulama: client_credentials akışı

**Ne işe yarar:** Her API çağrısı için gereken erişim belirtecini (access token) üretir.

```
POST https://{shop}.myshopify.com/admin/oauth/access_token
Content-Type: application/json

{
  "client_id":     "<uygulamanın client_id'si>",
  "client_secret": "<uygulamanın gizli anahtarı>",
  "grant_type":    "client_credentials"
}
```

Dönen yanıt `access_token`, `expires_in` ve `scope` alanlarını içerir.

**Kritik iki nokta:**

1. **Belirteç ~24 saat ömürlü.** `expires_in` değeri 86399 civarı geliyor. Kalıcı belirteç yok. Yani her çağrıdan önce "elimdeki belirteç geçerli mi, değilse yenile" mantığı **zorunlu**.
2. **Belirteçteki yetkiler, istenenle birebir aynı yazılmaz.** Bizim canlı belirteçte kapsam şöyle görünüyor ✓:

   ```
   write_inventory,read_locations,read_orders,write_products
   ```

   Uygulamada altı yetki seçili (`read_products`, `write_products`, `read_inventory`, `write_inventory`, `read_locations`, `read_orders`) ama belirteçte dört tane görünüyor — çünkü `write_*` kendi `read_*`'ını kapsıyor. **"Yetkim eksik gitmiş" diye panikleme**; `read_products` eksik görünse de ürün okuma çalışır.

## 5. Çağrı betiği deseni

**Ne işe yarar:** Belirteç üretme/yenileme işini tek bir yere toplar; gizli anahtar ve belirteç hiçbir zaman ekrana basılmaz.

Bizim kullandığımız betik — `/root/PnP-OS/scripts/shopify.sh`. Fatih bunu kendi projesine uyarlayabilir:

```bash
#!/usr/bin/env bash
# Shopify Admin API yardımcısı.
# Token'ı client_credentials ile üretir, .secrets/shopify_token.json içinde önbellekler,
# süresi dolunca yeniler. Token hiçbir zaman ekrana yazılmaz.
#
# Kullanım:
#   scripts/shopify.sh gql '<GraphQL sorgusu>' ['<degiskenler-json>']
#   scripts/shopify.sh rest GET /products.json?limit=5
set -euo pipefail

ENV_FILE="${SHOPIFY_ENV_FILE:-/root/PnP-OS/.secrets/shopify.env}"
TOKEN_FILE="${SHOPIFY_TOKEN_FILE:-/root/PnP-OS/.secrets/shopify_token.json}"

set -a; . "$ENV_FILE"; set +a
API_VERSION="${SHOPIFY_API_VERSION:-2026-07}"

mint_token() {
  local resp
  resp=$(curl -sS -X POST "https://$SHOPIFY_SHOP/admin/oauth/access_token" \
    -H 'Content-Type: application/json' \
    -d "{\"client_id\":\"$SHOPIFY_CLIENT_ID\",\"client_secret\":\"$SHOPIFY_CLIENT_SECRET\",\"grant_type\":\"client_credentials\"}")
  if ! printf '%s' "$resp" | grep -q '"access_token"'; then
    echo "Token alinamadi. Yanit: $(printf '%s' "$resp" | head -c 200)" >&2
    return 1
  fi
  local umask_old; umask_old=$(umask); umask 077
  printf '%s' "$resp" | python3 -c '
import json,sys,time
d=json.load(sys.stdin)
d["expires_at"]=int(time.time())+int(d.get("expires_in",86399))-60
json.dump(d,open(sys.argv[1],"w"))
' "$TOKEN_FILE"
  umask "$umask_old"
}

get_token() {
  if [ -f "$TOKEN_FILE" ] && python3 -c '
import json,sys,time
d=json.load(open(sys.argv[1]))
sys.exit(0 if d.get("expires_at",0) > time.time() else 1)
' "$TOKEN_FILE" 2>/dev/null; then :; else mint_token >&2; fi
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["access_token"])' "$TOKEN_FILE"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  gql)
    query="${1:?GraphQL sorgusu gerekli}"; vars="${2:-{\}}"
    body=$(python3 -c 'import json,sys; print(json.dumps({"query":sys.argv[1],"variables":json.loads(sys.argv[2])}))' "$query" "$vars")
    curl -sS -X POST "https://$SHOPIFY_SHOP/admin/api/$API_VERSION/graphql.json" \
      -H "X-Shopify-Access-Token: $(get_token)" \
      -H 'Content-Type: application/json' \
      -d "$body"
    ;;
  rest)
    method="${1:?HTTP metodu gerekli}"; path="${2:?Yol gerekli}"; shift 2
    curl -sS -X "$method" "https://$SHOPIFY_SHOP/admin/api/$API_VERSION${path}" \
      -H "X-Shopify-Access-Token: $(get_token)" \
      -H 'Content-Type: application/json' "$@"
    ;;
  token-status)
    if [ -f "$TOKEN_FILE" ]; then
      python3 -c '
import json,sys,time
d=json.load(open(sys.argv[1]))
left=int(d.get("expires_at",0)-time.time())
print("token var, kapsam:", d.get("scope","?"))
print("kalan sure (sn):", left if left>0 else "suresi dolmus")
' "$TOKEN_FILE"
    else
      echo "token yok"
    fi
    ;;
  *)
    echo "Kullanim: $0 {gql|rest|token-status} ..." >&2; exit 2
    ;;
esac
```

### Desenin önemli yerleri

| Ayrıntı | Neden böyle |
|---------|-------------|
| `expires_at = now + expires_in − 60` | 60 saniye emniyet payı; çağrı sırasında belirtecin ölmesini engeller |
| `umask 077` | Belirteç dosyası yalnız sahibine okunur olarak yazılır |
| Belirteç asla `echo` edilmez | Ekranda/kayıtta kalmasın; ajan ortamında da sızmaz |
| `mint_token >&2` | Üretim mesajları hata akışına gider, böylece `$(get_token)` çıktısını kirletmez |

### API uçları

| Ne | Uç | Kimlik başlığı |
|----|----|----------------|
| Admin GraphQL | `https://{shop}/admin/api/{sürüm}/graphql.json` | `X-Shopify-Access-Token` |
| Admin REST | `https://{shop}/admin/api/{sürüm}/{yol}` | `X-Shopify-Access-Token` |

### Ajan ortamında bir not

Bu betiğin varlık sebebinin bir kısmı güvenlik katmanıdır: bir yapay zeka ajanının `curl` ile elle belirteç üretmesi "kimlik bilgisi üretimi" sayılıp engellenebiliyor. Betik üzerinden çalışıyor, çünkü belirteç ekrana basılmıyor. Fatih insan olarak bu kısıtla karşılaşmaz, ama deseni korumak yine de doğru.

## 6. Gizli dosya düzeni

**Ne işe yarar:** Anahtarların koda ve git'e karışmasını engeller.

Dosya: `.secrets/shopify.env` — izin `600` (yalnız sahibi okur/yazar) ✓, `.gitignore` içinde ✓.

Değişken adları ve ne oldukları (**değerler bu belgede yoktur**):

| Değişken | İçerik | Nereden alınır | Gizli mi |
|----------|--------|----------------|----------|
| `SHOPIFY_SHOP` | Mağaza alan adı, örn. `xxxxx.myshopify.com` | Mağaza panelinden | Hayır |
| `SHOPIFY_ORG_ID` | Dev Dashboard organizasyon numarası | Dev Dashboard URL'si | Hayır |
| `SHOPIFY_APP_ID` | Uygulama numarası | Dev Dashboard | Hayır |
| `SHOPIFY_CLIENT_ID` | Uygulama kimliği | Dev Dashboard | Hayır |
| `SHOPIFY_CLIENT_SECRET` | **Gizli anahtar** | Dev Dashboard, bir kez gösterilir | **EVET** |
| `SHOPIFY_API_VERSION` | Admin API sürümü (bizde `2026-07`) | Seçim | Hayır |
| `SHOPIFY_APP_AUTOMATION_TOKEN` | **CLI otomasyon belirteci** — yalnız `shopify app deploy` için, 6 ay ömürlü | Dev Dashboard | **EVET** |
| `SHOPIFY_STOREFRONT_PUBLIC_TOKEN` | Storefront genel anahtarı (tarayıcıya gömülebilir) | Headless kanalı | Yarı (genel) |
| `SHOPIFY_STOREFRONT_PRIVATE_TOKEN` | **Storefront özel anahtarı** — yalnız sunucu | Headless kanalı | **EVET** |
| `SHOPIFY_STOREFRONT_API_VERSION` | Storefront API sürümü | Seçim | Hayır |

Türetilmiş dosya: `.secrets/shopify_token.json` — betiğin ürettiği belirteç önbelleği. Elle dokunulmaz, silinirse yeniden üretilir.

**Kural:** anahtarı sohbete, e-postaya, commit mesajına, log'a yazma. Bir kere düz metin geçtiyse Dev Dashboard'dan yeniden üret.

## 7. Yetkiler (scopes)

**Ne işe yarar:** Uygulamanın neye dokunabileceğini belirler. Eksik yetki sessiz davranış bozukluğu üretir.

Bizde açık olanlar:

```
read_products,write_products,read_inventory,write_inventory,read_locations,read_orders
```

### Yetki değişikliği

1. Dev Dashboard'da yetkiyi ekle/çıkar
2. **Yeni sürüm yayınla** (sürüm = yapılandırma; yayınlanmadan etkisi yok)
3. Belirteci yenile (`.secrets/shopify_token.json` sil ya da süresinin dolmasını bekle)

### Bizim yaşadığımız eksik yetki örneği

`write_publications` yetkisi **yok**. Sonuç: API ile açılan ürünler `status: ACTIVE` oluyor ama **hiçbir satış kanalında yayında olmuyor**. Hata mesajı almadık; ürünler sadece vitrinde görünmedi. Bizde bu zararsızdı (modüller paket bileşeni, vitrinde görünmemeleri isteniyordu). Fatih'in ürünleri vitrinde görünmesi gerekiyorsa bu yetki şart.

**Ders:** bir şey "sessizce olmuyorsa" önce yetki listesine bak.

## 8. Storefront API (Headless kanalı)

**Ne işe yarar:** Müşteri tarafı. Kendi sitenizde/uygulamanızda ürün gösterip sepet açmayı ve Shopify'ın ödeme sayfasına göndermeyi sağlar.

### Admin API'den farkı

| | Admin API | Storefront API |
|---|-----------|----------------|
| Kim kullanır | Yönetici/entegrasyon | Müşteri tarayıcısı veya sunucu |
| Ne yapar | Ürün açar, fiyat yazar, sipariş okur | Ürün/fiyat okur, sepet açar |
| Değiştirebilir mi | Evet | **Hayır** (sepet dışında salt okunur) |
| Belirteç ömrü | 24 saat, yenilenir | Kalıcı anahtar |

Tipik akış: ürünü/paketi göster → `cartCreate` ile sepet aç → dönen `checkoutUrl`'e müşteriyi yönlendir → ödemeyi Shopify alır.

### Anahtarlar ve uç

| Anahtar | Başlık | Nerede kullanılır |
|---------|--------|-------------------|
| Genel | `X-Shopify-Storefront-Access-Token` | Tarayıcıya gömülebilir |
| Özel | `Shopify-Storefront-Private-Token` | **Yalnız sunucu** |

Uç: `https://{shop}/api/{sürüm}/graphql.json`

### Kurulum

Mağaza panelinden **Headless** kanalı kurulur; kanal iki anahtarı da üretir. Bizde her ikisi de çalışır durumda ✓ (bu belge yazılırken `shop { name }` ve `products` sorguları ikisiyle de denendi, veri döndü).

**Dikkat:** Storefront yalnız **Headless kanalında yayınlanmış** ürünleri görür. Ürün Admin'de var ama Storefront'ta yok ise, sorun yayın (publication) ayarıdır.

### Betik

`/root/PnP-OS/scripts/shopify-storefront.sh`:

```bash
#!/usr/bin/env bash
# Shopify Storefront API yardımcısı (Headless kanalı).
#
# scripts/shopify.sh'ın eşi — o Admin API'ye, bu müşteri tarafı Storefront API'ye gider.
# Sunucu tarafında çalıştığı için ÖZEL anahtar kullanılır (Shopify-Storefront-Private-Token).
# Genel anahtar tarayıcıya gömülmek içindir; burada yalnız --genel ile denemek için var.
# Anahtar hiçbir zaman ekrana yazılmaz.
#
# Not: Storefront yalnız Headless kanalında yayınlanmış ürünleri görür.
#
# Kullanım:
#   scripts/shopify-storefront.sh '<GraphQL sorgusu>' ['<degiskenler-json>']
#   scripts/shopify-storefront.sh --genel '<GraphQL sorgusu>'
set -euo pipefail

ENV_FILE="${SHOPIFY_ENV_FILE:-/root/PnP-OS/.secrets/shopify.env}"
set -a; . "$ENV_FILE"; set +a

API_VERSION="${SHOPIFY_STOREFRONT_API_VERSION:-2026-07}"
BASLIK_ADI="Shopify-Storefront-Private-Token"
ANAHTAR="${SHOPIFY_STOREFRONT_PRIVATE_TOKEN:-}"

if [ "${1:-}" = "--genel" ]; then
  shift
  BASLIK_ADI="X-Shopify-Storefront-Access-Token"
  ANAHTAR="${SHOPIFY_STOREFRONT_PUBLIC_TOKEN:-}"
fi

if [ -z "$ANAHTAR" ]; then
  echo "Storefront anahtarı tanımlı değil ($ENV_FILE)." >&2
  exit 2
fi

query="${1:?GraphQL sorgusu gerekli}"
vars="${2:-{\}}"
body=$(python3 -c 'import json,sys; print(json.dumps({"query":sys.argv[1],"variables":json.loads(sys.argv[2])}))' "$query" "$vars")

curl -sS -X POST "https://$SHOPIFY_SHOP/api/$API_VERSION/graphql.json" \
  -H "Content-Type: application/json" \
  -H "$BASLIK_ADI: $ANAHTAR" \
  -d "$body"
```

### Anahtarları terminale güvenli girme

Anahtarı sohbete yapıştırmak yerine kendi terminalinde gizli girişle yazdır:

```bash
read -rsp "Storefront GENEL anahtar: " SF_PUB && echo
read -rsp "Storefront ÖZEL anahtar: "  SF_PRIV && echo
umask 077
{
  echo "SHOPIFY_STOREFRONT_PUBLIC_TOKEN=$SF_PUB"
  echo "SHOPIFY_STOREFRONT_PRIVATE_TOKEN=$SF_PRIV"
  echo "SHOPIFY_STOREFRONT_API_VERSION=2026-07"
} >> .secrets/shopify.env
unset SF_PUB SF_PRIV
```

**Bizim hatamız:** ilk denemede bu değerler boş kaydedildi (gizli girişte bir şey alınamadı, kimse fark etmedi). Yazdıktan sonra karakter sayısını kontrol et:

```bash
awk -F= '/STOREFRONT_(PUBLIC|PRIVATE)_TOKEN/{print $1"="length($2)" karakter"}' .secrets/shopify.env
```

## 9. Müşteri Hesabı API'si

**Ne işe yarar:** Müşterinin kendi hesabına girip siparişlerini, adreslerini görmesi gerektiğinde kullanılır (OAuth 2.0 ile müşteri girişi).

Bizim durumumuz: **şu an gerekmiyor.** Konfigüratörde müşteri girişi olacağı zaman devreye girecek. Dev Dashboard'daki "Uygulama ayarlama" (application setup) alanı bu yüzden **boş bırakıldı** — doldurmadan da Admin ve Storefront sorunsuz çalışıyor.

Fatih'in işinde müşteri girişi yoksa bu bölüm atlanabilir.

## 10. Admin paneli eklentileri (isteğe bağlı)

**Ne işe yarar:** Shopify'ın kendi yönetim paneline kendi arayüzünü koymayı sağlar — ürün sayfasında kendi kartın, uygulama sayfasında kendi ekranın. Bu bölüm bizim en çok zaman kaybettiğimiz yerdir; Fatih eklenti yazacaksa mutlaka okusun.

### 10.1 Ortam

Shopify CLI **Node 22** ister. Sistemdeki Node'u bozmamak için ayrı kurduk:

```bash
# Bizdeki kurulum: /opt/node22 (Node v22.21.1, @shopify/cli@4.8.0) ✓
PATH=/opt/node22/bin:$PATH shopify version    # -> 4.8.0
```

PATH'i öne almayı unutma; yoksa sistemdeki Node 20 ile çalışmaya kalkıp hata verir ✓ (denendi).

### 10.2 Sunucuda tarayıcı yoksa CLI girişi çöker

`shopify` komutu giriş için tarayıcı açmaya çalışır, `xdg-open` bulamayınca çöküyor. Çözüm — bağlantıyı yalnızca yazdıran sahte bir `xdg-open`:

```sh
# /usr/local/bin/xdg-open  (chmod +x)
#!/bin/sh
# Sunucuda tarayıcı yok; CLI'nin çökmemesi için bağlantıyı yalnızca yazdırır.
echo "AC: $1"
```

Sonra çıkan bağlantıyı kendi bilgisayarındaki tarayıcıda açıp doğrulama kodunu onaylıyorsun.

### 10.3 `shopify app dev` canlı mağazada çalışmaz

Yerel geliştirme sunucusu (`app dev`) yalnız **geliştirme mağazası** ister. Canlı mağazada kullanılamıyor. Biz geliştirme mağazası açmadık; her denemeyi `shopify app deploy` ile yeni sürüm yayınlayarak yaptık. Bu yavaş bir döngü — Fatih eklenti geliştirecekse bir geliştirme mağazası açmayı ciddi düşünsün.

Deploy için **otomasyon belirteci** gerekiyor (Dev Dashboard'dan üretilir, 6 ay ömürlü; `SHOPIFY_APP_AUTOMATION_TOKEN`). Böylece CLI her deploy'da giriş istemiyor.

### 10.4 Yapılandırma: doğrudan API erişimi

`shopify.app.toml` içinde şu blok **olmadan eklenti Admin API'ye sorgu atamıyor** (sessizce boş döner):

```toml
[access.admin]
direct_api_mode = "online"
embedded_app_direct_api_access = true
```

Bizim tam dosyamız (örnek olarak):

```toml
client_id = "5d7b975483cc5fc22d1843bb8ce2155a"
name = "PnP-OS Entegrasyon"
application_url = "https://example.com"
embedded = true

[access.admin]
direct_api_mode = "online"
embedded_app_direct_api_access = true

[auth]
redirect_urls = [ "https://example.com/auth/callback" ]

[access_scopes]
scopes = "read_products,write_products,read_inventory,write_inventory,read_locations,read_orders"

[webhooks]
api_version = "2026-07"
```

**UYARI:** `shopify app deploy` bu dosyayı uygulamanın **canlı yapılandırması** yapar. Buradaki `scopes` eksikse uygulama yetki kaybeder ve çalışan entegrasyon kırılır. İlk deploy öncesi `shopify app config link` ile canlı yapılandırmadan doğrula.

### 10.5 Bir eklentide iki hedef olmaz

Ürün sayfası bloğu (`admin.product-details.block.render`) ile uygulama ana sayfası (`admin.app.home.render`) **aynı eklentide olamaz**. Ayrı eklentilere böldük. Bizde üç eklenti var: `paket-bilesenleri`, `paket-blogu`, `paket-yonetimi`.

### 10.6 EN BÜYÜK TUZAK: JSX, Preact yerine React ile derleniyor

**Belirti:** eklenti yükleniyor, hata vermiyor, konsolda bir şey yok — **ama hiçbir şey çizmiyor.** Sürüm 3'ten 10'a kadar sekiz deneme bu yüzden boşa gitti.

**Sebep:** Shopify admin eklentileri **Preact** kullanır. Eklenti klasöründe `tsconfig.json` yoksa derleyici (esbuild) varsayılan olarak **React**'in JSX çalışma zamanını kullanıyor. Projenin ana dizininde React kurulu olduğu için derleme hatası da vermiyor. Preact, React nesnesi alınca **sessizce hiçbir şey çizmiyor**.

**Teşhis:** derleme çıktısındaki `.js.map` dosyasında ara —

```bash
grep -o "react/jsx-runtime\|preact/jsx-runtime" dist/*.js.map | sort -u
# "react/jsx-runtime" görüyorsan hastalık budur
```

**Çözüm:** her eklenti klasörüne şu `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "target": "ES2020",
    "allowJs": true,
    "moduleResolution": "node",
    "esModuleInterop": true
  },
  "include": ["./src"]
}
```

Bu dosya eklendikten sonra (sürüm 11) hem uygulama sayfası hem ürün kartı çizdi.

**İki ek ders:**

- Eklenti konsolu sayfanın konsoluna düşmez; hata ayıklarken tarayıcı konsoluna güvenme.
- Shopify'ın kendi yapay zeka asistanı (Sidekick) bu sorunda **yanlış teşhis verdi** ("eski/yeni `shopify.extend` imzası"). Uygulama kodunu görmüyor; teknik tanısını doğrulamadan kullanma.

---

# B KISMI — Mevcut uygulamanın devri

## 11. Üç yol ve sonuçları

**Ne işe yarar:** Fatih'in Koshoy'daki mevcut uygulamayı mı kullanacağına, yoksa kendi uygulamasını mı açacağına karar vermeyi sağlar.

### (i) Erişim paylaşımı — Fatih de yönetir

**Nasıl:** Fatih'e Shopify mağazasında personel/işbirlikçi erişimi verilir, ayrıca Dev Dashboard organizasyonuna (`228149843`) üye olarak davet edilir.

**Sonuç:** Fatih uygulamayı Dev Dashboard'dan görür, yetkilerini değiştirir, sürüm yayınlar, anahtarı kendisi üretir. Gizli anahtar hiç elden ele geçmez — en temiz paylaşım biçimi bu.

**Risk:** Aynı uygulamayı iki taraf yönetir. Fatih'in yayınladığı bir sürüm bizim yapılandırmamızın üstüne yazar.

### (ii) Yalnız gizli anahtarı paylaşmak

**Nasıl:** `SHOPIFY_CLIENT_SECRET` güvenli bir kanalla Fatih'e iletilir; uygulama ve yönetimi bizde kalır.

**Sonuç:** Fatih API'ye bağlanır, ama uygulamanın **yetkileri ortaktır**. Bizim yayınladığımız her yeni sürüm onun erişimini de etkiler (yetki daraltırsak onun kodu kırılır). Ayrıca iki taraf aynı hız sınırını paylaşır.

**Risk:** Gizli anahtarın bir kopyası daha dolaşıma girer. İş bitince Dev Dashboard'dan yeniden üretilmeli (eski geçersiz olur).

### (iii) Fatih kendi uygulamasını açar — **ÖNERİLEN**

**Nasıl:** Bu belgenin A kısmını uygulayıp kendi Dev Dashboard uygulamasını açar, kendi yetkilerini seçer, kendi anahtarını üretir.

**Sonuç:** Yetkiler, sürümler, hız sınırı ve anahtarlar ayrışır.

**Gerekçe (tek cümle):** Koshoy'un 252 ürünlü canlı entegrasyonu ve üç admin eklentisi aynı uygulamanın yapılandırmasına bağlı olduğu için, ayrı uygulama bir tarafın hatasının öbürünü kırmasını yapısal olarak imkânsız kılar.

### Hangi durumda hangisi

| Fatih'in işi | Öneri |
|--------------|-------|
| Başka bir uygulama bağlantısı / kendi entegrasyonu | **(iii)** kendi uygulaması |
| Koshoy mağazasının mevcut entegrasyonunu birlikte geliştirmek | (i) organizasyon üyeliği |
| Tek seferlik kısa bir deneme | (ii), iş sonunda anahtar yenilenir |

### Anahtar paylaşımı kuralları

- Sohbet, e-posta, ekran görüntüsü, commit — **düz metin asla**
- Parola yöneticisi ya da şifreli kanal kullanılır
- Düz metin geçtiyse: Dev Dashboard → gizli anahtarı yeniden üret → `.secrets/shopify.env` güncelle → belirteç önbelleğini sil
- Belge, log ve commit mesajında anahtar aranmalı (bkz. §13.5)

---

# C KISMI — Her durumda gerekli

## 12. Tuzaklar ve deneyimler

**Ne işe yarar:** Bizim bedelini ödediğimiz hataları Fatih'in tekrar etmesini önler.

### Kimlik ve erişim

| Tuzak | Gerçek |
|-------|--------|
| Kalıcı belirteç arama | Yok. Belirteç 24 saatlik; yenileme mantığı şart (§4) |
| Belirteçte yetki eksik görünüyor | `write_*`, `read_*`'ı kapsar; belirteçte sadece `write_*` yazar ✓ |
| Yetki ekledim ama çalışmıyor | Dev Dashboard'da **yeni sürüm yayınlanmadı** ya da belirteç yenilenmedi |
| Ürün açıldı, vitrinde yok | `write_publications` yetkisi eksik; hata vermez, sessizdir |

### Ürün ve fiyat

| Tuzak | Gerçek |
|-------|--------|
| Mevcut ürünün fiyatını `productSet` ile güncellemek | **Varyant kimliğini değiştirir.** O varyanta bağlı bütün paketler kırılır. Fiyat için `productVariantsBulkUpdate` kullan |
| `productSet` ile ürün açarken varyant hatası | Varyantta `optionValues` zorunlu; varyantsız ürün için `Title` / `Default Title` seçeneği verilir |
| Girilen fiyat net sanılıyor | Bizim mağazada `taxesIncluded = true` ✓ — Shopify girilen fiyatı **KDV dahil** kabul eder. İç sistem net hesaplıyorsa vitrine çıkarken KDV eklenmeli |

### Paketler (bundle)

| Tuzak | Gerçek |
|-------|--------|
| Paket güncellendi, fiyat kendiliğinden düzelir sanmak | **Düzelmez.** Shopify paket fiyatını güncellemede yeniden hesaplamıyor; fiyatı her seferinde biz yazıyoruz |
| Başka uygulamanın paketini düzenlemek | Olmaz. Bileşenleri bağlayan uygulama paketin sahibidir; hata: `This product is currently owned by a different app`. Okumak serbest |
| Pakete KDV/vergi ayarı koymak | Ödeme adımında **yok sayılıyor**; bileşenler ayrı vergilendiriliyor. Vergi oranı bileşende (mamulde) durmalı |
| Vergi geçersiz kılmayı API'den yönetmek | API'si yok. Geçersiz kılma yalnız elle eklenen koleksiyon üzerinden panelden yapılıyor; koleksiyonun API'si var |
| Büyük paket kurmak | Sınır: en çok 30 bileşen, 3 seçenek; iç içe paket yok *(Shopify dokümanından okundu; § referansı elimde yok)* |

### Eklentiler

| Tuzak | Gerçek |
|-------|--------|
| Eklenti boş çiziyor | Önce `.js.map`'e bak: `react/jsx-runtime` varsa `tsconfig.json` eksik (§10.6) |
| Eklenti Admin API'ye gidemiyor | `[access.admin]` bloğu eksik (§10.4) |
| Blok + uygulama sayfası tek eklentide | Olmaz, ayır (§10.5) |
| Hata ayıklarken tarayıcı konsoluna güvenmek | Eklenti konsolu sayfaya düşmez |
| Sidekick'in teknik tanısı | Kodu görmüyor; doğrulanmadan kullanılmaz |

### Çalışma yöntemi

| Tuzak | Gerçek |
|-------|--------|
| `npx @shopify/dev-mcp` | 30 sn zaman aşımı; genel kur (§2) |
| `shopify` komutu Node 20 ile | CLI Node 22 ister; PATH'i öne al (§10.1) |
| Sunucuda CLI girişi | `xdg-open` yok, çöker; sahte `xdg-open` koy (§10.2) |
| `shopify app dev` canlı mağazada | Çalışmaz, geliştirme mağazası ister (§10.3) |

## 13. Doğrulama adımları

**Ne işe yarar:** Kurulumun gerçekten çalıştığını sırayla kanıtlar. Her adım öncekine dayanır; biri patlarsa sorun oradadır.

### 13.1 Belirteç üretiliyor mu

```bash
scripts/shopify.sh token-status
```

**Beklenen:** `token var, kapsam: ...` ve kalan süre saniye cinsinden (ilk çağrıda ~86 bin). "token yok" diyorsa henüz üretilmemiş — bir sorgu çalıştır, kendisi üretir. Yanıt `Token alinamadi` ise `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` / `SHOPIFY_SHOP` üçlüsünden biri yanlıştır.

### 13.2 Admin API'ye bağlanıyor mu

```bash
scripts/shopify.sh gql '{ shop { name myshopifyDomain currencyCode taxesIncluded } }'
```

**Beklenen:** Mağaza adı, `myshopify.com` alan adı, para birimi ve KDV dahil olup olmadığı. Bizdeki gerçek çıktı ✓:

```json
{"data":{"shop":{"name":"Koshoy","myshopifyDomain":"21tn4m-us.myshopify.com",
 "currencyCode":"TRY","taxesIncluded":true}}}
```

`taxesIncluded` değerini **not al** — fiyat yazarken KDV'yi kimin ekleyeceğini bu belirler.

### 13.3 Ürün yetkisi çalışıyor mu

```bash
scripts/shopify.sh gql '{ products(first:3) { nodes { id title status } } }'
```

**Beklenen:** En çok üç ürün, kimlik + başlık + durum. `ACCESS_DENIED` dönerse yetki eksik ya da sürüm yayınlanmamıştır. Boş liste dönerse mağazada ürün yoktur (yetki sorunu değildir).

### 13.4 Storefront tarafı — sepet açılıyor mu

```bash
scripts/shopify-storefront.sh '
mutation { cartCreate(input:{}) { cart { id checkoutUrl } userErrors { message } } }'
```

**Beklenen:** Boş bir sepet kimliği ve bir `checkoutUrl`. Müşteri o adrese gönderildiğinde Shopify ödeme sayfası açılır. Hata dönerse Headless kanalı kurulu değildir ya da anahtar/başlık eşleşmiyordur (genel anahtar ile özel başlık karıştırılmış olabilir).

Ürün okuma denemesi:

```bash
scripts/shopify-storefront.sh '{ products(first:2) { nodes { title } } }'
```

Boş dönerse ürünler **Headless kanalında yayınlanmamıştır** (Admin'de var olmaları yetmez).

### 13.5 Gizli değer sızıntısı taraması

Her devir/paylaşım öncesi:

```bash
grep -rnE "shpat_|shpca_|shpss_|shpua_" --exclude-dir=.git . | head
git log -p -S "client_secret" | head
```

**Beklenen:** boş çıktı.

## 14. Kaynak dosyalar

**Ne işe yarar:** Fatih örnek almak istediğinde nereye bakacağını gösterir. Yollar bizim deponun (`/root/PnP-OS`) içidir.

| Dosya | Ne örnek olur |
|-------|---------------|
| `scripts/shopify.sh` | Admin API çağrı deseni, belirteç üretme/önbellekleme (§5) |
| `scripts/shopify-storefront.sh` | Storefront çağrı deseni, iki anahtar ayrımı (§8) |
| `scripts/shopify-fiyat-hesapla.py` | Veritabanından fiyat okuyup salt-ekleme bir kayıt tablosuna yazma |
| `scripts/shopify-urun-yukle.py` | Yeni ürün açma (`productSet`) ve mevcut üründe **yalnız fiyat** güncelleme (`productVariantsBulkUpdate`) ayrımı |
| `scripts/shopify-liste-denetle.py` | Shopify'daki ürünlerin hâlâ yerinde olduğunu denetleme |
| `platform/shopify-app/shopify.app.toml` | Uygulama yapılandırması, `[access.admin]` bloğu (§10.4) |
| `platform/shopify-app/extensions/*/tsconfig.json` | Preact JSX ayarı — eklentinin çizmesini sağlayan dosya (§10.6) |
| `platform/schema/045_shopify_urun_aktarim.sql` + `048`, `049` | Aktarım kayıt tablosu: değişmez, salt ekleme, tarihli fiyat belgesi |
| `/usr/local/bin/xdg-open` | Sunucuda CLI girişi için sahte tarayıcı (§10.2) |

### Mimari not (bizim seçimimiz, zorunlu değil)

Ana kayıt bizde **kendi veritabanımızda**; Shopify vitrin. Fiyatın tek kaynağı veritabanındaki merkezi fonksiyonlar (kâr marjı + KDV), Shopify'a yalnız sonuç yazılıyor. Ayrıca "bu tarihte bu ürünü bu fiyata listeledik" bilgisini tutan **değişmez, salt ekleme** bir tablo var — satır güncellenmez, her değişiklik yeni satırdır. Fatih'in işinde benzer bir izlenebilirlik gerekiyorsa bu desen hazır.

---

**Bu belgede gizli anahtar yoktur; anahtarlar ayrı ve şifreli kanalla iletilir.**
