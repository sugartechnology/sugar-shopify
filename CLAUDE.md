# sugar-shopify

Bu repoda birbirinden bağımsız Shopify app'leri var:

| Klasör | App |
|---|---|
| `/` (kök) | Sugar app'i |
| `connect/` | Connect app'i |
| `koshoy/` | Koshoy Studio — Koshoy mağazasının yapay zeka tasarım asistanı backend'i. Kendi talimatı: `koshoy/CLAUDE.md` |

Alt klasörler kök uygulamayla kod paylaşmaz; her birinin kendi `package.json`,
Prisma ve `shopify.app.toml` dosyası vardır. Kök Docker build'i bunları
`.dockerignore` ile dışarıda bırakır.
