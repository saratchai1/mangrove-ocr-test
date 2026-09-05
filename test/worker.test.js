import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const baseEnv = {
  ASSETS: {
    fetch: async () => new Response("asset", { status: 200 }),
  },
};

async function json(response) {
  return response.json();
}

test("config exposes schemas and provider readiness without exposing secrets", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/config"),
    { ...baseEnv, OCR_SPACE_API_KEY: "secret-value" },
  );
  const payload = await json(response);

  assert.equal(response.status, 200);
  assert.equal(payload.provider.configured, true);
  assert.equal(payload.persistence, "none");
  assert.equal(payload.documentTypes[0].id, "progress_update_letter");
  assert.equal(JSON.stringify(payload).includes("secret-value"), false);
});

test("confirm endpoint validates and canonicalizes reviewed fields without persistence", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviewAcknowledged: true,
        requestId: "ocr-request-1",
        documentType: "progress_update_letter",
        sourceFile: { name: "sample.pdf", type: "application/pdf", size: 200 },
        fields: {
          documentNumber: " ROK-CC-69-06-004 ",
          references: "รายการที่ 1\nรายการที่ 2",
          unknownField: "must be removed",
        },
      }),
    }),
    baseEnv,
  );
  const payload = await json(response);

  assert.equal(response.status, 200);
  assert.equal(payload.status, "confirmed_in_poc");
  assert.equal(payload.fields.documentNumber, "ROK-CC-69-06-004");
  assert.deepEqual(payload.fields.references, ["รายการที่ 1", "รายการที่ 2"]);
  assert.equal("unknownField" in payload.fields, false);
  assert.equal(payload.persistence, "none");
  assert.ok(payload.confirmationId);
});

test("optional POC token protects both OCR and confirmation routes", async () => {
  const env = { ...baseEnv, OCR_POC_ACCESS_TOKEN: "test-token" };
  const response = await worker.fetch(
    new Request("https://example.test/api/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
    env,
  );
  const payload = await json(response);

  assert.equal(response.status, 401);
  assert.equal(payload.error.code, "INVALID_POC_TOKEN");
});

test("API routes reject unsupported HTTP methods", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/health", { method: "POST" }),
    baseEnv,
  );
  const payload = await json(response);

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET");
  assert.equal(payload.error.code, "METHOD_NOT_ALLOWED");
});

test("OCR route sends Thai options upstream and returns structured editable fields", async (t) => {
  const upstreamText = `
ที่ ROK-CC-69-06-004
8 มิถุนายน 2569
เรื่อง อัพเดทการเติบโตของกล้าไม้หลังเพาะชำเดือนที่ 3
เรียน กรรมการบริหาร บริษัท ตัวอย่าง จำกัด
อ้างถึง 1. หนังสือเดือนที่ 2 เลขที่ ROK-CC-69-05-001 ลงวันที่ 13 พฤษภาคม 2569
สิ่งที่แนบมาด้วย 1. รายละเอียดพื้นที่
2. แผนงานทั้ง 8 แปลง
ตามที่ บริษัท ผู้ดำเนินงาน จำกัด ได้ดำเนินงานแล้ว
(นายสมชาย ใจดี)
กรรมการบริหาร
`;

  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(String(url), "https://api.ocr.space/parse/image");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.apikey, "provider-secret");
    assert.equal(options.body.get("language"), "tha");
    assert.equal(options.body.get("OCREngine"), "3");
    assert.equal(options.body.get("filetype"), "PDF");
    assert.ok(options.body.get("file") instanceof File);

    return new Response(
      JSON.stringify({
        ParsedResults: [{ FileParseExitCode: 1, ParsedText: upstreamText }],
        ProcessingTimeInMilliseconds: "125",
        IsErroredOnProcessing: false,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const form = new FormData();
  form.append(
    "file",
    new File(["%PDF-1.4\nPOC"], "ROK-CC-69-06-004.pdf", { type: "application/pdf" }),
  );
  form.append("documentType", "progress_update_letter");

  const response = await worker.fetch(
    new Request("https://example.test/api/ocr", { method: "POST", body: form }),
    { ...baseEnv, OCR_SPACE_API_KEY: "provider-secret" },
  );
  const payload = await json(response);

  assert.equal(response.status, 200);
  assert.equal(payload.provider.language, "tha");
  assert.equal(payload.pageCount, 1);
  assert.equal(payload.processingTimeMs, 125);
  assert.equal(payload.fields.documentNumber.value, "ROK-CC-69-06-004");
  assert.equal(payload.fields.documentDate.value, "8 มิถุนายน 2569");
  assert.equal(payload.fields.attachments.value.length, 2);
  assert.equal(payload.persistence, "none");
});
