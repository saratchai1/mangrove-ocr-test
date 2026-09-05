import test from "node:test";
import assert from "node:assert/strict";
import { ConfirmationValidationError, normalizeConfirmationInput } from "../src/confirm.js";

function validInput() {
  return {
    reviewAcknowledged: true,
    requestId: "request-123",
    documentType: "progress_update_letter",
    sourceFile: {
      name: "example.pdf",
      type: "application/pdf",
      size: 1234,
    },
    fields: {
      documentNumber: " DOC-001 ",
      documentDate: "4 มิถุนายน 2569",
      subject: "ทดสอบ",
      recipient: "บริษัท ตัวอย่าง จำกัด",
      references: [" รายการ 1 ", "", "รายการ 2"],
      attachments: "เอกสาร 1\nเอกสาร 2",
      senderOrganization: "บริษัท ผู้ส่ง จำกัด",
      signerName: "นายสมชาย ใจดี",
      signerPosition: "กรรมการบริหาร",
      details: "รายละเอียด",
      ignoredExtraField: "must not pass through",
    },
  };
}

test("normalizes and whitelists confirmed fields", () => {
  const result = normalizeConfirmationInput(validInput());

  assert.equal(result.fields.documentNumber, "DOC-001");
  assert.deepEqual(result.fields.references, ["รายการ 1", "รายการ 2"]);
  assert.deepEqual(result.fields.attachments, ["เอกสาร 1", "เอกสาร 2"]);
  assert.equal("ignoredExtraField" in result.fields, false);
  assert.equal(result.sourceFile.size, 1234);
});

test("requires an explicit review acknowledgment", () => {
  const input = validInput();
  input.reviewAcknowledged = false;

  assert.throws(
    () => normalizeConfirmationInput(input),
    (error) => error instanceof ConfirmationValidationError && error.code === "REVIEW_NOT_ACKNOWLEDGED",
  );
});

test("rejects an unsupported document type", () => {
  const input = validInput();
  input.documentType = "unknown";

  assert.throws(
    () => normalizeConfirmationInput(input),
    (error) => error instanceof ConfirmationValidationError && error.code === "UNSUPPORTED_DOCUMENT_TYPE",
  );
});
