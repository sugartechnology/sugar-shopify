---
name: ai-pipeline
description: Create, update, delete, validate, and restore GraalJS AI pipelines on disk and via the live /api/ai/pipelines API. Use when the user wants a pipeline, says pipeline istiyorum, mentions ai-pipeline, GraalJS pipeline scripts, or asks to create/update/delete/restore a pipeline.
---

# AI Pipeline

Kullanıcı bir pipeline tarif ettiğinde (ör. “şu şekilde bir pipeline istiyorum”) script + input/output sözleşmesini yaz. İstenirse diske bırak, istenirse canlı servise create/update/delete/restore yap.

Kaynak gerçek: `AiPipelineController`, `PipelineScriptValidator`, `PipelineAssistMapper`, `ScriptHostServices`. Host API uydurma.

REST, `util` / `services`, `$types` ayrıntısı: [reference.md](reference.md).
Canlı çağrı: [scripts/pipeline.sh](scripts/pipeline.sh) çalıştır (okuma değil).

## Ne zaman?

- Yeni pipeline isteği (metin tarif, input/output şekli, “şuna benzer”)
- Mevcut pipeline güncelle / kopyala / sil
- Version listesi veya geri alma
- Disk örneği (`src/main/resources/pipelines/`) veya canlı kayıt

## Hedef seçimi

Kullanıcı açık söylediyse ona uy. Söylemediyse:

| Kullanıcı | Hedef |
|-----------|--------|
| “diske yaz”, “örnek bırak”, “resources’a koy” | Disk: `src/main/resources/pipelines/<id>.js`, `.input.json`, `.output.json` |
| “servise koy”, “güncelle”, “sil”, “geri al”, “çalıştır” | Canlı `/api/ai/pipelines` |
| Belirsiz | Validate + taslak yaz; sonra disk mi API mi diye sor. API çağrısı uydurma. |

İkisi birden istenebilir: önce disk, sonra `create` / `update`.

Şablon: [`src/main/resources/pipelines/shopify-pdp.js`](../../../src/main/resources/pipelines/shopify-pdp.js) + `.input.json` + `.output.json`.

## Identifier

`^[a-z0-9][a-z0-9-]{0,79}$` (küçük harf, rakam, tire). Rezerve: `preview`, `assist`, `validate`.

## Script kuralları

Script GraalJS (ECMAScript 2024, strict). Binding’ler: `input`, `files`, `services`, `util`.

```javascript
const params = util.parseInput(input);

function main() {
  return { echo: params };
}

main();
```

- `input` için `JSON.parse` yazma; `util.parseInput` kullan.
- `asText`, `asNumber`, `guessMime`, `imageRef`, `parseInput` script içinde yeniden tanımlama.
- `log()` yok. Token logu host’ta otomatik.
- `Promise` / `await` yok. Çoklu upload için `services.files.uploadAsync` + `getJob` poll.
- Yalnızca current input JSON’daki **top-level** key’leri oku. `$types` input alanı değil; okuma.
- `main()` dönüşünün top-level key’leri current output JSON’da olmalı. Fazla key kaydı kırar.
- Host API icat etme. Liste: [reference.md](reference.md).

## Yeni pipeline

1. Çakışma kontrolü: servis ayaktaysa `scripts/pipeline.sh list`. Diskte `src/main/resources/pipelines/` bak. Slug seç.
2. Contract yaz: örnek değerler + `$types`. Leaf: `text`, `number`, `boolean`, `url`, `image`, `any`. Dizi: `["image"]`. Nesne: `{ "url": "image" }`. Boş `[]` → `["any"]`. Boş `{}` nesnedir, text değil.
3. Script yaz (yukarıdaki giriş + `main()`). Okunan/dönen key’ler contract ile aynı olsun.
4. Validate: `scripts/pipeline.sh validate-disk <id>` — `https://ai.sugartech.io` (`POST /api/ai/pipelines/validate`). Auth `.env` / `.env.local` (`PIPELINE_EMAIL`, `PIPELINE_PASSWORD`). Hata varsa kaydetme; contract veya script’i düzelt.
5. Hedefe yaz:
   - Disk: üç dosya (`<id>.js`, `<id>.input.json`, `<id>.output.json`).
   - API: `scripts/pipeline.sh pack <id> | scripts/pipeline.sh create` veya elle JSON body. Create/update `save` version snapshot alır.

## Update / delete / restore

- **Update:** `scripts/pipeline.sh get <id>` → değiştir → validate → `update <id>`.
- **Delete:** identifier’ı doğrula → `delete <id>` (version satırları da silinir).
- **Restore:** `versions <id>` → `restore <id> <n>`. Restore **yalnızca source** yükler; input/output contract değişmez.

## Servise bağlanma

- Default base: `https://ai.sugartech.io`. Validate ve diğer canlı çağrılar buraya gider.
- Script repo kökündeki `.env` sonra `.env.local` okur. Kullanılan key’ler: `PIPELINE_BASE_URL`, `PIPELINE_EMAIL`, `PIPELINE_PASSWORD`, `PIPELINE_TOKEN`.
- Login: `POST /api/v1/auth/login` (`PIPELINE_EMAIL` + `PIPELINE_PASSWORD`). Token: `PIPELINE_TOKEN`.
- Credential’ı skill’e, chate veya commit’e yazma. `.env*` zaten gitignore.
- Key yoksa `.env.local`’e ekle veya kullanıcıya sor; uydurma.
- Local override: `PIPELINE_BASE_URL=https://api.local.test:4764` ve gerekirse `PIPELINE_INSECURE=1`.
- Host cevap vermezse disk taslağını bırak; API sonucu uydurma.

```bash
# repo kökünden — validate ai.sugartech.io
.cursor/skills/ai-pipeline/scripts/pipeline.sh validate-disk <id>
```

## Mini örnek

Kullanıcı: “prompt alsın, echo ile dönsün.”

`echo-prompt.input.json`:

```json
{
  "$types": { "prompt": "text" },
  "prompt": "hello"
}
```

`echo-prompt.output.json`:

```json
{
  "$types": { "echo": {} },
  "echo": {}
}
```

`echo-prompt.js`:

```javascript
const params = util.parseInput(input);

function main() {
  return { echo: params };
}

main();
```

## Sık hatalar

- Output’ta olmayan extra return key
- Input’ta olmayan `params.foo`
- `$types`’ı script’ten okumak / return etmek
- `JSON.parse(input)` (`util.parseInput` kullan)
- `Promise` / `await` (host senkron; job poll)
- Rezerve identifier (`preview`, `assist`, `validate`)
- Validate etmeden kaydetmek
- Servis kapalıyken API cevabı uydurmak
