import { getDocumentSchema, getPublicDocumentTypes } from "./document-schemas.js";
import { extractDocument } from "./extract.js";
import { ConfirmationValidationError, normalizeConfirmationInput } from "./confirm.js";

const DEFAULT_ENDPOINT = "https://api.ocr.space/parse/image";
const DEFAULT_MAX_FILE_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 60_000;
const ALLOWED_FILE_TYPES = new Map([
  ["application/pdf", "PDF"],
  ["image/jpeg", "JPG"],
  ["image/png", "PNG"],
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      return jsonResponse(
        {
          ok: true,
          service: "mangrove-ocr-test",
          provider: "ocr.space",
          providerConfigured: Boolean(env.OCR_SPACE_API_KEY),
        },
        200,
      );
    }

    if (url.pathname === "/api/config") {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      return jsonResponse({
        provider: {
          id: "ocr.space",
          label: "OCR.space",
          configured: Boolean(env.OCR_SPACE_API_KEY),
        },
        requiresPocToken: Boolean(env.OCR_POC_ACCESS_TOKEN),
        upload: {
          maxFileBytes: readPositiveInteger(env.OCR_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES),
          acceptedMimeTypes: [...ALLOWED_FILE_TYPES.keys()],
          acceptedExtensions: [".pdf", ".jpg", ".jpeg", ".png"],
        },
        documentTypes: getPublicDocumentTypes(),
        persistence: "none",
      });
    }

    if (url.pathname === "/api/ocr") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      return handleOcrRequest(request, env);
    }

    if (url.pathname === "/api/confirm") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      return handleConfirmRequest(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return jsonError(404, "API_NOT_FOUND", "ไม่พบ API endpoint ที่ร้องขอ");
    }

    return env.ASSETS.fetch(request);
  },
};


async function handleConfirmRequest(request, env) {
  const requestId = crypto.randomUUID();

  if (!(await hasValidPocToken(request, env.OCR_POC_ACCESS_TOKEN))) {
    return jsonError(401, "INVALID_POC_TOKEN", "รหัสสำหรับทดสอบ POC ไม่ถูกต้อง", requestId);
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonError(415, "JSON_REQUIRED", "คำขอยืนยันต้องใช้ application/json", requestId);
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return jsonError(400, "INVALID_CONFIRMATION_BODY", "อ่านข้อมูลยืนยันไม่สำเร็จ", requestId);
  }

  if (new TextEncoder().encode(rawBody).byteLength > 65_536) {
    return jsonError(413, "CONFIRMATION_TOO_LARGE", "ข้อมูลยืนยันใหญ่เกินขอบเขต POC", requestId);
  }

  let input;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return jsonError(400, "INVALID_JSON", "รูปแบบ JSON ไม่ถูกต้อง", requestId);
  }

  let normalized;
  try {
    normalized = normalizeConfirmationInput(input);
  } catch (error) {
    if (error instanceof ConfirmationValidationError) {
      return jsonError(400, error.code, error.message, requestId);
    }
    return jsonError(400, "INVALID_CONFIRMATION", "ข้อมูลยืนยันไม่ถูกต้อง", requestId);
  }

  return jsonResponse(
    {
      status: "confirmed_in_poc",
      confirmationId: crypto.randomUUID(),
      confirmedAt: new Date().toISOString(),
      ...normalized,
      persistence: "none",
    },
    200,
    requestId,
  );
}

async function handleOcrRequest(request, env) {
  const requestId = crypto.randomUUID();

  if (!(await hasValidPocToken(request, env.OCR_POC_ACCESS_TOKEN))) {
    return jsonError(401, "INVALID_POC_TOKEN", "รหัสสำหรับทดสอบ POC ไม่ถูกต้อง", requestId);
  }

  if (!env.OCR_SPACE_API_KEY) {
    return jsonError(
      503,
      "OCR_PROVIDER_NOT_CONFIGURED",
      "ยังไม่ได้ตั้งค่า OCR_SPACE_API_KEY ใน Worker secret",
      requestId,
    );
  }

  let incoming;
  try {
    incoming = await request.formData();
  } catch {
    return jsonError(400, "INVALID_MULTIPART", "คำขอต้องเป็น multipart/form-data", requestId);
  }

  const documentType = String(incoming.get("documentType") ?? "");
  if (!getDocumentSchema(documentType)) {
    return jsonError(400, "UNSUPPORTED_DOCUMENT_TYPE", "ประเภทเอกสารไม่ถูกต้อง", requestId);
  }

  const file = incoming.get("file");
  if (!(file instanceof File) || file.size <= 0) {
    return jsonError(400, "FILE_REQUIRED", "กรุณาเลือกไฟล์เอกสาร", requestId);
  }

  const maxFileBytes = readPositiveInteger(env.OCR_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES);
  if (file.size > maxFileBytes) {
    return jsonError(
      413,
      "FILE_TOO_LARGE",
      `ไฟล์ใหญ่เกินขนาดที่ POC กำหนด (${formatBytes(maxFileBytes)})`,
      requestId,
    );
  }

  const normalizedMime = normalizeMimeType(file.type, file.name);
  const providerFileType = ALLOWED_FILE_TYPES.get(normalizedMime);
  if (!providerFileType) {
    return jsonError(415, "UNSUPPORTED_FILE_TYPE", "รองรับเฉพาะ PDF, JPG และ PNG", requestId);
  }

  if (!(await hasExpectedMagicBytes(file, normalizedMime))) {
    return jsonError(415, "FILE_SIGNATURE_MISMATCH", "ชนิดไฟล์ไม่ตรงกับข้อมูลภายในไฟล์", requestId);
  }

  const providerForm = new FormData();
  providerForm.append("file", file, file.name);
  providerForm.append("filetype", providerFileType);
  providerForm.append("language", "tha");
  providerForm.append("OCREngine", "3");
  providerForm.append("scale", "true");
  providerForm.append("detectOrientation", "true");
  providerForm.append("isTable", "true");
  providerForm.append("isOverlayRequired", "false");

  const endpoint = String(env.OCR_SPACE_ENDPOINT || DEFAULT_ENDPOINT);
  const timeoutMs = readPositiveInteger(env.OCR_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  let providerResponse;
  try {
    providerResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: env.OCR_SPACE_API_KEY,
      },
      body: providerForm,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    const timedOut = error instanceof Error && error.name === "AbortError";
    return jsonError(
      504,
      timedOut ? "OCR_TIMEOUT" : "OCR_UPSTREAM_UNAVAILABLE",
      timedOut ? "OCR ใช้เวลานานเกินกำหนด" : "ไม่สามารถติดต่อ OCR provider ได้",
      requestId,
    );
  }
  clearTimeout(timeout);

  let providerPayload;
  try {
    providerPayload = await providerResponse.json();
  } catch {
    return jsonError(502, "OCR_INVALID_RESPONSE", "OCR provider ส่งผลลัพธ์ที่อ่านไม่ได้", requestId);
  }

  if (!providerResponse.ok) {
    return jsonError(
      502,
      "OCR_UPSTREAM_ERROR",
      providerErrorMessage(providerPayload) || `OCR provider ตอบกลับ HTTP ${providerResponse.status}`,
      requestId,
    );
  }

  const parsedResults = Array.isArray(providerPayload.ParsedResults) ? providerPayload.ParsedResults : [];
  const successfulPages = parsedResults.filter(
    (page) => Number(page?.FileParseExitCode) === 1 && typeof page?.ParsedText === "string",
  );
  const ocrText = successfulPages
    .map((page) => page.ParsedText.trim())
    .filter(Boolean)
    .join("\n\n--- PAGE BREAK ---\n\n");

  if (!ocrText) {
    return jsonError(
      422,
      "OCR_NO_TEXT",
      providerErrorMessage(providerPayload) || "OCR ไม่พบข้อความที่นำไปเติมข้อมูลได้",
      requestId,
    );
  }

  const extraction = extractDocument({
    ocrText,
    filename: file.name,
    documentType,
  });

  const providerWarnings = parsedResults
    .filter((page) => Number(page?.FileParseExitCode) !== 1)
    .map((page, index) => `หน้า ${index + 1}: ${page?.ErrorMessage || page?.ErrorDetails || "อ่านไม่สำเร็จ"}`);

  const providerProcessingTime = Number.parseInt(providerPayload.ProcessingTimeInMilliseconds, 10);

  return jsonResponse(
    {
      requestId,
      documentType,
      sourceFile: {
        name: file.name,
        type: normalizedMime,
        size: file.size,
      },
      provider: {
        id: "ocr.space",
        engine: 3,
        language: "tha",
      },
      pageCount: successfulPages.length,
      processingTimeMs: Number.isFinite(providerProcessingTime)
        ? providerProcessingTime
        : Date.now() - startedAt,
      ocrText,
      fields: extraction.fields,
      overallConfidence: extraction.overallConfidence,
      warnings: [...extraction.warnings, ...providerWarnings],
      persistence: "none",
    },
    200,
    requestId,
  );
}

function providerErrorMessage(payload) {
  const values = [payload?.ErrorMessage, payload?.ErrorDetails]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => typeof value === "string" && value.trim());
  return values.join("; ").slice(0, 600);
}

function normalizeMimeType(mimeType, filename) {
  const normalized = String(mimeType || "").toLowerCase().split(";")[0].trim();
  if (ALLOWED_FILE_TYPES.has(normalized)) return normalized;

  const lowerName = String(filename || "").toLowerCase();
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg";
  if (lowerName.endsWith(".png")) return "image/png";
  return normalized;
}

async function hasExpectedMagicBytes(file, mimeType) {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (mimeType === "application/pdf") {
    return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  }
  if (mimeType === "image/png") {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return png.every((value, index) => bytes[index] === value);
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return false;
}

async function hasValidPocToken(request, configuredToken) {
  if (!configuredToken) return true;
  const supplied = request.headers.get("X-POC-Access-Token") || "";
  return safeEqual(supplied, configuredToken);
}

function safeEqual(left, right) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(String(left));
  const rightBytes = encoder.encode(String(right));
  if (leftBytes.length !== rightBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function methodNotAllowed(methods) {
  return jsonResponse(
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "HTTP method ไม่ถูกต้อง",
      },
    },
    405,
    undefined,
    { Allow: methods.join(", ") },
  );
}

function jsonError(status, code, message, requestId) {
  return jsonResponse(
    {
      error: { code, message },
      ...(requestId ? { requestId } : {}),
    },
    status,
    requestId,
  );
}

function jsonResponse(payload, status = 200, requestId, extraHeaders = {}) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  if (requestId) headers.set("X-Request-ID", requestId);

  return new Response(JSON.stringify(payload), {
    status,
    headers,
  });
}
