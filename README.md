# Mangrove OCR Test

A small full-stack POC for uploading a Thai project document, calling an OCR API, and prefilling structured fields for human review.

## What this POC demonstrates

- The user chooses a known document type before upload.
- PDF/JPG/PNG files are validated in a Cloudflare Worker.
- The OCR API key stays in a Worker secret and never reaches the browser.
- OCR.space is called with Thai OCR settings.
- The Worker maps OCR text into editable fields with confidence, source, and evidence.
- The user can correct every field before confirmation.
- Confirmation is posted to a stateless validation endpoint and returns canonical JSON. No original file, OCR text, or structured field is persisted.

The first schema is `progress_update_letter`, covering:

- เลขที่หนังสือ
- วันที่หนังสือ
- เรื่อง
- เรียนถึง
- อ้างถึง
- สิ่งที่แนบมาด้วย
- บริษัทผู้ส่ง
- ผู้ลงนามและตำแหน่ง
- รายละเอียดหลัก

The sample PDF supplied for testing is intentionally **not committed** because this is a public repository.

## Architecture

- Static frontend: plain HTML/CSS/JavaScript in `public/`
- API: Cloudflare Worker in `src/worker.js`
- OCR provider: OCR.space
- Field mapping: deterministic parser in `src/extract.js`
- Persistence: none

See [`docs/FLOW.md`](docs/FLOW.md) for the sequence and integration boundaries.

## Local setup

```bash
npm install
cp .dev.vars.example .dev.vars
```

Put a free OCR.space API key in `.dev.vars`:

```dotenv
OCR_SPACE_API_KEY=your_key_here
```

Optional protection for the POC:

```dotenv
OCR_POC_ACCESS_TOKEN=a_long_random_test_token
```

Run:

```bash
npm run dev
```

Wrangler will print the local URL. Open it, select the document type, and upload a PDF/JPG/PNG.

## Cloudflare deployment

Set secrets without committing them:

```bash
npx wrangler secret put OCR_SPACE_API_KEY
npx wrangler secret put OCR_POC_ACCESS_TOKEN
npm run deploy
```

`OCR_POC_ACCESS_TOKEN` is optional locally but recommed if the deployed POC is reachable from the public internet. This POC has no user authentication or rate-limit binding yet.

## API contract

### `GET /api/config`

Returns supported document schemas, upload limits, provider readiness, and whether a POC access token is required.

### `POST /api/ocr`

Multipart form fields:

- `file`: PDF/JPG/PNG
- `documentType`: currently `progress_update_letter`

Optional header when configured:

- `X-POC-Access-Token`

Successful response includes:

- request/file/provider metadata
- page count and processing time
- raw OCR text
- structured fields with `value`, `confidence`, `source`, and `evidence`
- review warnings

### `POST /api/confirm`

JSON body:

- `reviewAcknowledged`: must be `true`
- `requestId`: the OCR request ID
- `documentType`: the selected schema ID
- `sourceFile`: name, MIME type, and size returned by `/api/ocr`
- `fields`: user-reviewed field values

The Worker validates the schema, removes unknown fields, normalizes list/text values, and returns a confirmation ID plus canonical JSON. This endpoint is intentionally stateless and still does not write to a database.

### `GET /api/health`

Returns service status and whether the OCR provider key is configured. It never exposes the key.

## Validation

```bash
npm run validate
npm run dry-run
```

The unit tests cover Thai field extraction, wrapped headings, numbered sections, filename fallback, confirmation normalization, unknown-field removal, explicit review acknowledgment, and the rule that a date inside `อ้างถึง` must not become the current document date.

## POC limits

The default upload limit is 1 MiB to match the intended free-tier test. Override `OCR_MAX_FILE_BYTES` only after checking the provider plan. OCR quality depends on scan clarity and layout. Missing or uncertain values remain editable and must be checked against the original document.
