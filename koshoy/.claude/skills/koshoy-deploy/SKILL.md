---
name: koshoy-deploy
description: How Koshoy Studio (sugar-shopify/koshoy) reaches production — Coolify auto-deploys on git push, Shopify app config deploy, and how to verify. Use when deploying, releasing or checking the live Koshoy app.
---

# Koshoy Studio deploy

## Sunucu (Coolify) — push = deploy
- Coolify uygulaması: `koshoy-studio` (proje `shopify`, ortam production, sunucu `application-server`), kaynak `sugartechnology/sugar-shopify`, klasör `/koshoy`, Dockerfile.
- **Coolify, izlediği branch'e push gelince otomatik deploy eder. Ayrıca Coolify API'sinden ya da panelden deploy tetikleme.** Sadece commit + `git push`.
- İzlenen branch şu an `feature/koshoy-backend` (PR merge olunca `master`'a çevrilecek).
- Canlı adres: https://koshoy.sugartech.io — kontrol: `POST /apps/koshoy/studio/session` doğrudan çağrılınca 401 + `{"ok":false,"error":"unavailable",…}` beklenir (imza yok demek, sunucu ayakta).
- Uçtan uca kontrol mağaza üzerinden: `POST https://www.koshoy.com/apps/koshoy/studio/session` → 200 + `enabled:true`.
- Deploy ilerlemesi/logları için Coolify API (`/api/v1/applications/<uuid>/logs`) okunabilir; token `_koshoy-wt/.coolify-token` (asla ekrana yazdırma).

## Shopify uygulama ayarları
- `shopify.app.toml` (adresler, App Proxy `/apps/koshoy`, izinler) değişirse: `koshoy/` içinde `npx shopify app deploy --allow-updates`.
- Kod değişikliği için gerekmez.
- `shopify app dev` çalıştırma: uygulama adreslerini tünele çevirir ve canlıyı bozar; Koshoy organizasyonunda dev mağaza da yok.

## Gizli değerler
- Coolify env'lerinde: `SHOPIFY_API_SECRET` (Koshoy Studio'nun kendi secret'ı), `SHOPIFY_SERVICE_SECRET` (tagservice servis şifresi). Değerleri sohbete/loga yazma.

## Çalışma şekli
- Her adımdan önce ne yapılacağını kullanıcıya tek cümleyle söyle, sonra yap, sonra kısaca sonucu bildir.
