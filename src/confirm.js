import { getDocumentSchema } from "./document-schemas.js";

const MAX_TEXT_LENGTH = 12_000;
const MAX_LIST_ITEMS = 50;
const MAX_LIST_ITEM_LENGTH = 2_000;

export class ConfirmationValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConfirmationValidationError";
    this.code = code;
  }
}

export function normalizeConfirmationInput(input) {
  if (!isPlainObject(input)) {
    throw new ConfirmationValidationError("INVALID_CONFIRMATION_BODY", "ข้อมูลยืนยันต้องเป็น JSON object");
  }

  if (input.reviewAcknowledged !== true) {
    throw new ConfirmationValidationError(
      "REVIEW_NOT_ACKNOWLEDGED",
      "ต้องยืนยันว่าผู้ใช้ได้ตรวจและแก้ไขข้อมูลแล้ว",
    );
  }

  const documentType = cleanString(input.documentType, 120);
  const schema = getDocumentSchema(documentType);
  if (!schema) {
    throw new ConfirmationValidationError("UNSUPPORTED_DOCUMENT_TYPE", "ประเภทเอกสารไม่ถูกต้อง");
  }

  if (!isPlainObject(input.fields)) {
    throw new ConfirmationValidationError("FIELDS_REQUIRED", "ไม่พบข้อมูลช่องที่ต้องยืนยัน");
  }

  const normalizedFields = {};
  for (const field of schema.fields) {
    const rawValue = input.fields[field.key];
    normalizedFields[field.key] = field.type === "list" ? normalizeList(rawValue) : normalizeText(rawValue);
  }

  const sourceFile = isPlainObject(input.sourceFile) ? input.sourceFile : {};
  const fileSize = Number(sourceFile.size);

  return {
    requestId: cleanString(input.requestId, 120),
    documentType: {
      id: schema.id,
      label: schema.label,
    },
    sourceFile: {
      name: cleanString(sourceFile.name, 255),
      type: cleanString(sourceFile.type, 120),
      size: Number.isFinite(fileSize) && fileSize >= 0 ? Math.floor(fileSize) : 0,
    },
    fields: normalizedFields,
  };
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new ConfirmationValidationError("INVALID_FIELD_VALUE", "ค่าช่องข้อความต้องเป็นข้อความ");
  }
  const normalized = String(value).trim();
  if (normalized.length > MAX_TEXT_LENGTH) {
    throw new ConfirmationValidationError("FIELD_TOO_LONG", "ข้อความในช่องยาวเกินขอบเขต POC");
  }
  return normalized;
}

function normalizeList(value) {
  if (value === null || value === undefined || value === "") return [];
  const input = Array.isArray(value) ? value : String(value).split("\n");
  if (input.length > MAX_LIST_ITEMS) {
    throw new ConfirmationValidationError("TOO_MANY_LIST_ITEMS", "จำนวนรายการในช่องมากเกินขอบเขต POC");
  }

  return input
    .map((item) => {
      if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
        throw new ConfirmationValidationError("INVALID_LIST_ITEM", "รายการต้องเป็นข้อความ");
      }
      const normalized = String(item).trim();
      if (normalized.length > MAX_LIST_ITEM_LENGTH) {
        throw new ConfirmationValidationError("LIST_ITEM_TOO_LONG", "ข้อความของรายการยาวเกินขอบเขต POC");
      }
      return normalized;
    })
    .filter(Boolean);
}

function cleanString(value, maxLength) {
  const normalized = String(value ?? "").trim();
  return normalized.slice(0, maxLength);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
