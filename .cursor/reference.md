# AI Pipeline reference

Kaynaklar: `AiPipelineController`, `AiPipelineRequest`, `AiPipelineServiceImpl`, `PipelineScriptValidator`, `ScriptHostServices`, `PipelineAssistMapper`.

Default host: `https://ai.sugartech.io`. Base path: `/api/ai/pipelines`. Auth: `.env` / `.env.local` içindeki `PIPELINE_EMAIL` + `PIPELINE_PASSWORD` (Bearer login) veya `PIPELINE_TOKEN`.

## REST

| Method | Path | Body / not |
|--------|------|------------|
| GET | `/` | Özet liste (`source` / contract yok) |
| GET | `/{identifier}` | Tam kayıt: source + input/output + types + credits |
| POST | `/` | Create. 201. Version snapshot `save` |
| PUT | `/{identifier}` | Kısmi update. Snapshot `save` |
| POST | `/{identifier}/duplicate` | `{id}-copy`. Snapshot `duplicate` |
| DELETE | `/{identifier}` | 204. Version satırları da silinir |
| GET | `/{identifier}/versions` | Liste (`source` yok) |
| POST | `/{identifier}/versions` | `{ "note" }` isteğe bağlı. 201 |
| GET | `/{identifier}/versions/{n}` | `source` dahil |
| POST | `/{identifier}/versions/{n}/restore` | Yalnızca **source** geri yükler; contract değişmez |
| POST | `/validate` | `{ source, input, output }` → `{ ok, diagnostics[] }` |
| POST | `/preview` | `{ source, input }` — kaydetmeden çalıştır |
| POST | `/{identifier}/run` | JSON input. Pipeline `enabled` olmalı |
| POST | `/{identifier}/run` (multipart) | parts: `input`, `files` |
| POST | `/{identifier}/run-async` | 202 `{ jobId, status, identifier }` |
| GET | `/jobs/{jobId}` | `{ jobId, status, identifier, result, error }` |

Rezerve identifier (create/update slug olamaz): `preview`, `assist`, `validate`.

### Create / update body

```json
{
  "identifier": "echo-prompt",
  "name": "Echo prompt",
  "description": "optional",
  "source": "const params = util.parseInput(input);\nfunction main() { return { echo: params }; }\nmain();\n",
  "enabled": true,
  "credits": 0,
  "input": { "$types": { "prompt": "text" }, "prompt": "hello" },
  "output": { "$types": { "echo": {} }, "echo": {} }
}
```

- `identifier`: `^[a-z0-9][a-z0-9-]{0,79}$`. Create’te zorunlu. Update’te verilirse rename.
- `name` yoksa identifier kullanılır.
- `source` yoksa default echo script.
- `enabled` default `true`.
- `credits` ≥ 0.
- `input` / `output` `$types` içerebilir. Ayrı `inputTypes` / `outputTypes` de kabul edilir; `$types` tercih et.

List summary `source` ve contract döndürmez. Detay için `GET /{identifier}`.

### Validate diagnostics

`target`: `script` | `input` | `output`. `line` / `column` script hatalarında gelir.

Sık mesajlar:

- `Script uses input keys that are not in input: <key>`
- `Script returns output keys that are not in output: <key>`
- `Script compile error: …`

Kaydetmeden önce `ok: true` şart. Create/update aynı validator’ı sunucuda tekrar çalıştırır.

## $types ve key eşleşme

Leaf: `text`, `number`, `boolean`, `url`, `image`, `any`.

- Dizi şeması tek eleman: `["image"]`, `["any"]`. Boş `[]` → `["any"]`.
- Nesne: `{ "url": "image", "score": "number" }`. Boş `{}` nesnedir, text değil.
- `$types` input/output alanı değil. Script okumaz, return etmez. Değer key’leriyle senkron tut.

Validator yalnızca **top-level** key bakar:

- Okuma: `params.<key>`, `input.<key>`, `const { key } = params`.
- Dönüş: `return { key: … }` literal key’leri. Output’ta olmayan extra key hata.

Alt alan (`params.products[0].title`) top-level `products` yeterliyse geçersiz sayılmaz.

## Host bindings

Uydurma API yok. Aşağıdakiler `ScriptHostServices` + `ScriptHostUtils`.

### util

| Çağrı | Sonuç |
|-------|--------|
| `util.parseInput(input)` | Object. String ise JSON parse. Boş → `{}` |
| `util.asText(value)` | trim string; null → `""` |
| `util.asNumber(value, fallback)` | finite number; değilse fallback (`NaN` olabilir) |
| `util.guessMime(nameOrUrl)` | `image/png\|webp\|gif\|jpeg` (uzantıdan; default jpeg) |
| `util.imageRef(value)` | `{ url, mimeType }` veya `{ contentBase64, mimeType }`. URL, data URL, raw base64, veya `{ url \| contentBase64 \| data, mimeType, name }`. Boş → `null` |

### services.ai

`runCommand({ prompt, platform, images, responseMimeType, tag, userId, jobId, model, aspectRatio, imageSize, imageInputQuality, responseJsonSchema })`

- `images[]`: `{ url, mimeType }` veya `{ contentBase64|data, mimeType }`
- `platform`: enum string (`GOOGLE`, …)
- `tag` yoksa `pipeline/<identifier>`
- Dönüş: `{ text, mimeType, videoMimeType, imageDataBase64, videoDataBase64, usageMetadata }`

`runCommandAsync(same)` → `{ jobId, status, imageUrl, error, …response }`.
`getJob(jobId)` aynı şekil. Job yoksa throw.

### services.files

`upload({ name, folder, contentType, contentBase64 })` → `{ url }`. Senkron; çok dosyada kullanma.

`uploadAsync(same)` hemen `{ jobId, status: "processing", url, error }`.
`getJob(jobId)` → `completed` (`url`) veya `failed` (`error`). Promise yok; poll et.

### services.prompts

`getActive(type, platform)` — `type` `PromptType` enum (büyük harf). `platform` ikinci argüman.

### services.design

`generate({ imageBase64|contentBase64, contentType, imageUrl, colors, roomType, style, tenantId, products: [{ id, quantity }] })` → DesignResponse map.

`regenerate({ designId, products: [{ id, quantity }], changes: [{ previous, current }] })`.

### services.products

`search({ filterable|search, language, page, size })` → `{ results, totalElements, page, size, filterable }`.

`searchWithAi({ imageBase64|contentBase64, contentType, style, colorPalette, room, language })`.

### services.moderation

`moderateText(content)` / `moderateImage(imageUrl)` → `{ ok: true }`. Boş içerik throw.

## Default source (create’te source yoksa)

```javascript
const params = typeof input === "string" ? JSON.parse(input || "{}") : (input ?? {});

function main() {
  return { echo: params };
}

main();
```

Yeni script yazarken bunu kopyalama. `util.parseInput(input)` kullan.

## Disk örnekleri

`src/main/resources/pipelines/<identifier>.js`
`src/main/resources/pipelines/<identifier>.input.json`
`src/main/resources/pipelines/<identifier>.output.json`

Canlı kayıt: `ai_pipeline` + `ai_pipeline_version`. Disk dosyaları otomatik yüklenmez; API veya editor ile push et.
