import { getDocumentSchema } from "./document-schemas.js";

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

const DOCUMENT_NUMBER_PATTERN = /\b[A-Z]{2,}(?:-[A-Z]{2,})*-\d{2}-\d{2}-\d{3}\b/i;
const THAI_DATE_PATTERN = new RegExp(
  `(?:วันที่\\s*)?(\\d{1,2}\\s+(?:${THAI_MONTHS.join("|")})\\s+\\d{4})`,
  "i",
);
const PERSON_PATTERN = /^\(?\s*((?:นาย|นางสาว|นาง)\s*[ก-๙A-Za-z][ก-๙A-Za-z.'’\-\s]{2,80}?)\s*\)?$/;
const ORG_PATTERN = /บริษัท\s+[^\n,;:()]{2,100}?\s+จำกัด/g;

export function normalizeOcrText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function captureSection(text, startLabels, endLabels) {
  let selected = null;

  for (const label of startLabels) {
    const escaped = escapeRegex(label);
    const expression = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[:：]?\\s*`, "im");
    const match = expression.exec(text);
    if (!match) continue;
    if (!selected || (match.index ?? 0) < selected.index) {
      selected = {
        index: match.index ?? 0,
        contentStart: (match.index ?? 0) + match[0].length,
        label,
      };
    }
  }

  if (!selected) return null;

  const remainder = text.slice(selected.contentStart);
  let endIndex = remainder.length;

  for (const label of endLabels) {
    const escaped = escapeRegex(label);
    const expression = new RegExp(`\\n\\s*${escaped}\\s*[:：]?`, "im");
    const match = expression.exec(remainder);
    if (match && (match.index ?? remainder.length) < endIndex) {
      endIndex = match.index ?? endIndex;
    }
  }

  const value = remainder.slice(0, endIndex).trim();
  if (!value) return null;

  return {
    value,
    evidence: `${selected.label}\n${value}`.trim(),
  };
}

function collapseSectionValue(value) {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripNumberPrefix(value) {
  return value
    .replace(/^\s*(?:\d+|[๑-๙]+)\s*[.)]\s*/, "")
    .replace(/^\s*[-–—•]\s*/, "")
    .trim();
}

export function splitNumberedItems(value) {
  const normalized = normalizeOcrText(value)
    .replace(/\s+(?=(?:\d+|[๑-๙]+)\s*[.)]\s+)/g, "\n")
    .trim();

  if (!normalized) return [];

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const items = [];
  let current = "";
  let sawNumbering = false;

  for (const line of lines) {
    const startsNewItem = /^(?:\d+|[๑-๙]+)\s*[.)]\s*/.test(line);
    if (startsNewItem) {
      sawNumbering = true;
      if (current) items.push(current.trim());
      current = stripNumberPrefix(line);
      continue;
    }

    if (current) {
      current = `${current} ${line}`.trim();
    } else {
      current = stripNumberPrefix(line);
    }
  }

  if (current) items.push(current.trim());

  if (!sawNumbering && items.length === 1 && lines.length > 1) {
    return lines.map(stripNumberPrefix).filter(Boolean);
  }

  return items.filter(Boolean);
}

function preambleOf(text) {
  const marker = /(?:^|\n)\s*(?:เรื่อง|เรียน|อ้างถึง|สิ่งที่แนบมาด้วย)\s*[:：]?/im.exec(text);
  if (!marker) return text.slice(0, 600);
  return text.slice(0, marker.index ?? 0).trim();
}

function filenameWithoutExtension(filename) {
  return String(filename ?? "")
    .replace(/\.[^.]+$/, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .trim();
}

function filenameDocumentNumber(filename) {
  return filenameWithoutExtension(filename).match(DOCUMENT_NUMBER_PATTERN)?.[0] ?? "";
}

function filenameSubject(filename) {
  const stem = filenameWithoutExtension(filename);
  const number = stem.match(DOCUMENT_NUMBER_PATTERN)?.[0] ?? "";
  const withoutNumber = number ? stem.replace(number, "") : stem;
  return withoutNumber.replace(/^[-_\s]+/, "").replace(/[_]+/g, " ").trim();
}

function allOrganizations(text) {
  const matches = text.match(ORG_PATTERN) ?? [];
  return matches
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value, index, array) => array.indexOf(value) === index);
}

function extractSigner(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(PERSON_PATTERN);
    if (!match) continue;

    const signerName = match[1].replace(/\s+/g, " ").trim();
    let signerPosition = "";

    for (let next = index + 1; next < Math.min(lines.length, index + 5); next += 1) {
      const candidate = lines[next].trim();
      if (!candidate) continue;
      if (/^(?:บริษัท|เลขที่|โทร|Tel|Fax|www\.)/i.test(candidate)) break;
      if (candidate.length <= 100) signerPosition = candidate;
      break;
    }

    return { signerName, signerPosition, signerLineIndex: index };
  }

  return { signerName: "", signerPosition: "", signerLineIndex: -1 };
}

function extractBody(lines, signerLineIndex) {
  let bodyStart = lines.findIndex((line) => /^(?:ตามที่|ตามหนังสือ|ด้วย)(?:\s|$)/.test(line));
  if (bodyStart < 0) {
    const attachmentIndex = lines.findIndex((line) => /^สิ่งที่แนบมาด้วย|^สิ่งที่ส่งมาด้วย|^เอกสารแนบ/.test(line));
    bodyStart = attachmentIndex >= 0 ? attachmentIndex + 1 : -1;
  }
  if (bodyStart < 0) return "";

  const end = signerLineIndex > bodyStart ? signerLineIndex : lines.length;
  const bodyLines = lines.slice(bodyStart, end);

  while (bodyLines.length && /^(?:จึงเรียนมาเพื่อทราบ|ขอแสดงความนับถือ)$/.test(bodyLines.at(-1))) {
    if (bodyLines.at(-1) === "จึงเรียนมาเพื่อทราบ") break;
    bodyLines.pop();
  }

  return bodyLines.join("\n").trim().slice(0, 2500);
}

function makeField(value, confidence, source, evidence = "") {
  const hasValue = Array.isArray(value) ? value.length > 0 : Boolean(String(value ?? "").trim());
  return {
    value: hasValue ? value : Array.isArray(value) ? [] : "",
    confidence: hasValue ? Number(confidence.toFixed(2)) : 0,
    source: hasValue ? source : "empty",
    evidence: hasValue ? String(evidence ?? "").slice(0, 1200) : "",
  };
}

function overallConfidence(fields) {
  const scores = Object.values(fields)
    .filter((field) => (Array.isArray(field.value) ? field.value.length : field.value))
    .map((field) => field.confidence);
  if (!scores.length) return 0;
  return Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2));
}

export function extractDocument({ ocrText, filename = "", documentType }) {
  const schema = getDocumentSchema(documentType);
  if (!schema) {
    throw new Error(`Unsupported document type: ${documentType}`);
  }

  const text = normalizeOcrText(ocrText);
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const preamble = preambleOf(text);

  const preambleNumber = preamble.match(DOCUMENT_NUMBER_PATTERN)?.[0] ?? "";
  const fallbackNumber = filenameDocumentNumber(filename);
  const documentNumber = preambleNumber || fallbackNumber;
  const documentNumberSource = preambleNumber ? "ocr" : fallbackNumber ? "filename" : "empty";

  const preambleDate = preamble.match(THAI_DATE_PATTERN)?.[1] ?? "";
  const subjectSection = captureSection(text, ["เรื่อง"], [
    "เรียน",
    "อ้างถึง",
    "สิ่งที่แนบมาด้วย",
    "สิ่งที่ส่งมาด้วย",
    "เอกสารแนบ",
    "ตามที่",
  ]);
  const subject = collapseSectionValue(subjectSection?.value);
  const fallbackSubject = subject ? "" : filenameSubject(filename);
  const recipientSection = captureSection(text, ["เรียน"], [
    "อ้างถึง",
    "สิ่งที่แนบมาด้วย",
    "สิ่งที่ส่งมาด้วย",
    "เอกสารแนบ",
    "ตามที่",
  ]);
  const recipient = collapseSectionValue(recipientSection?.value);

  const referencesSection = captureSection(text, ["อ้างถึง"], [
    "สิ่งที่แนบมาด้วย",
    "สิ่งที่ส่งมาด้วย",
    "เอกสารแนบ",
    "ตามที่",
  ]);
  const attachmentsSection = captureSection(text, ["สิ่งที่แนบมาด้วย", "สิ่งที่ส่งมาด้วย", "เอกสารแนบ"], [
    "ตามที่",
    "ตามหนังสือ",
    "ด้วย",
  ]);

  const references = referencesSection ? splitNumberedItems(referencesSection.value) : [];
  const attachments = attachmentsSection ? splitNumberedItems(attachmentsSection.value) : [];

  const signer = extractSigner(lines);
  const body = extractBody(lines, signer.signerLineIndex);
  const bodyOrganizations = allOrganizations(body);
  const senderOrganization =
    bodyOrganizations.find((organization) => !recipient.includes(organization)) ?? bodyOrganizations[0] ?? "";

  const fields = {
    documentNumber: makeField(
      documentNumber,
      preambleNumber ? 0.97 : fallbackNumber ? 0.68 : 0,
      documentNumberSource,
      preambleNumber ? preambleNumber : fallbackNumber,
    ),
    documentDate: makeField(preambleDate, 0.95, "ocr", preambleDate),
    subject: makeField(
      subject || fallbackSubject,
      subject ? 0.93 : fallbackSubject ? 0.6 : 0,
      subject ? "ocr" : fallbackSubject ? "filename" : "empty",
      subjectSection?.evidence || fallbackSubject,
    ),
    recipient: makeField(recipient, 0.93, "ocr", recipientSection?.evidence ?? ""),
    references: makeField(references, 0.86, "ocr", referencesSection?.evidence ?? ""),
    attachments: makeField(attachments, 0.86, "ocr", attachmentsSection?.evidence ?? ""),
    senderOrganization: makeField(senderOrganization, 0.74, "derived", senderOrganization),
    signerName: makeField(signer.signerName, 0.82, "ocr", signer.signerName),
    signerPosition: makeField(signer.signerPosition, 0.72, "derived", signer.signerPosition),
    details: makeField(body, 0.68, "derived", body),
  };

  const warnings = ["ผล OCR และค่าที่เติมให้อัตโนมัติเป็นข้อมูลตั้งต้น ต้องตรวจสอบกับเอกสารต้นฉบับก่อนยืนยัน"];
  if (documentNumberSource === "filename") {
    warnings.push("เลขที่หนังสือหาไม่พบในเนื้อหา OCR จึงใช้ค่าจากชื่อไฟล์และลดระดับความมั่นใจ");
  }
  if (!preambleDate) {
    warnings.push("ไม่พบวันที่หนังสือในส่วนหัว และระบบตั้งใจไม่ใช้วันที่ของเอกสารอ้างถึงแทน");
  }
  if (!subject && fallbackSubject) {
    warnings.push("หัวเรื่องหาไม่พบจากคำว่า “เรื่อง” จึงใช้ข้อความหลังเลขที่หนังสือในชื่อไฟล์เป็นค่าตั้งต้น");
  }

  for (const field of schema.fields) {
    if (!(field.key in fields)) {
      fields[field.key] = makeField("", 0, "empty");
    }
  }

  return {
    fields,
    warnings,
    overallConfidence: overallConfidence(fields),
  };
}
