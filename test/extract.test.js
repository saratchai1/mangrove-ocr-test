import test from "node:test";
import assert from "node:assert/strict";
import { extractDocument, normalizeOcrText, splitNumberedItems } from "../src/extract.js";

const DOCUMENT_TYPE = "progress_update_letter";

test("extracts structured fields from a Thai progress-update letter", () => {
  const text = `
ที่ ROK-CC-69-06-004
วันที่ 4 มิถุนายน 2569
เรื่อง อัพเดทการเติบโตของกล้าไม้หลังเพาะชำเดือนที่ 3
เรียน กรรมการบริหาร บริษัท ตัวอย่าง เทคโนโลยี จำกัด
อ้างถึง 1. หนังสือรายงานเดือนที่ 2 เลขที่ ROK-CC-69-05-001 ลงวันที่ 13 พฤษภาคม 2569
สิ่งที่แนบมาด้วย 1. รายละเอียดข้อมูลพื้นที่ฟื้นฟู
2. แผนการดำเนินงานทั้ง 8 แปลง
3. ข้อมูลการเติบโตและอัตราการรอดตายเดือนที่ 3
ตามที่ บริษัท ผู้ดำเนินงาน จำกัด ได้แจ้งการดำเนินงานตามหนังสืออ้างถึง
ทางบริษัทได้ติดตามการเติบโตของกล้าไม้ครบทั้ง 8 แปลง และเตรียมหลักหมายแนวปลูกแล้ว
จึงเรียนมาเพื่อทราบ
(นายสมชาย ใจดี)
กรรมการบริหาร
`;

  const result = extractDocument({
    ocrText: text,
    filename: "ROK-CC-69-06-004.pdf",
    documentType: DOCUMENT_TYPE,
  });

  assert.equal(result.fields.documentNumber.value, "ROK-CC-69-06-004");
  assert.equal(result.fields.documentNumber.source, "ocr");
  assert.equal(result.fields.documentDate.value, "4 มิถุนายน 2569");
  assert.equal(result.fields.subject.value, "อัพเดทการเติบโตของกล้าไม้หลังเพาะชำเดือนที่ 3");
  assert.match(result.fields.recipient.value, /กรรมการบริหาร/);
  assert.equal(result.fields.references.value.length, 1);
  assert.equal(result.fields.attachments.value.length, 3);
  assert.equal(result.fields.senderOrganization.value, "บริษัท ผู้ดำเนินงาน จำกัด");
  assert.equal(result.fields.signerName.value, "นายสมชาย ใจดี");
  assert.equal(result.fields.signerPosition.value, "กรรมการบริหาร");
  assert.ok(result.fields.details.value.startsWith("ตามที่ บริษัท ผู้ดำเนินงาน จำกัด"));
  assert.match(result.fields.details.value, /ครบทั้ง 8 แปลง/);
});

test("uses the current document number from the filename and does not reuse a reference date", () => {
  const text = `
เรียน กรรมการบริหาร บริษัท ตัวอย่าง จำกัด
อ้างถึง 1. หนังสือเลขที่ ROK-CC-69-05-001 ลงวันที่ 13 พฤษภาคม 2569
สิ่งที่แนบมาด้วย 1. รายงานผล
ตามที่ บริษัท ผู้ดำเนินงาน จำกัด ได้ดำเนินงานแล้ว
`;

  const result = extractDocument({
    ocrText: text,
    filename: "ROK-CC-69-06-004 อัพเดทการเติบโตของกล้าไม้.pdf",
    documentType: DOCUMENT_TYPE,
  });

  assert.equal(result.fields.documentNumber.value, "ROK-CC-69-06-004");
  assert.equal(result.fields.documentNumber.source, "filename");
  assert.equal(result.fields.documentDate.value, "");
  assert.equal(result.fields.subject.source, "filename");
  assert.ok(result.warnings.some((warning) => warning.includes("ไม่ใช้วันที่ของเอกสารอ้างถึง")));
});

test("joins wrapped lines into their numbered list item", () => {
  const items = splitNumberedItems(`
1. หนังสือรายงานการดำเนินงาน
ฉบับเดือนก่อน
2. แผนการดำเนินงานทั้ง 8 แปลง
3. รายละเอียดการติดตามผล
`);

  assert.deepEqual(items, [
    "หนังสือรายงานการดำเนินงาน ฉบับเดือนก่อน",
    "แผนการดำเนินงานทั้ง 8 แปลง",
    "รายละเอียดการติดตามผล",
  ]);
});

test("normalizes whitespace without destroying line boundaries", () => {
  assert.equal(normalizeOcrText("  เรียน   บริษัท A\r\n\r\n  เรื่อง  ทดสอบ  "), "เรียน บริษัท A\n\nเรื่อง ทดสอบ");
});

test("keeps wrapped subject and recipient lines from the supplied letter layout", () => {
  const text = `
ที่ ROK-CC-69-06-004
8 มิถุนายน 2569
เรื่อง อัพเดทการเติบโตของกล้าไม้หลังเพาะชำ และอัตราการรอดตายของกล้าไม้เพาะชำเดือนที่ 3 และการ
เตรียมไม้หลักหมายแนวปลูก
เรียน กรรมการบริหาร ของบริษัท สยาม พีซี เทคโนโลยี จำกัด
อ้างถึง 1. หนังสืออัพเดทการเติบโตของกล้าไม้หลังเพาะชำ และอัตราการรอดตายของกล้าไม้เพาะชำเดือนที่ 2
ROK-CC-69-05-001 ลงวันที่ 13 พฤษภาคม 2569
สิ่งที่แนบมาด้วย 1. รายละเอียดข้อมูลพื้นที่ในการฟื้นฟูจากภัยพิบัติน้ำท่วม
2. แผนการดำเนินงานทั้ง 8 แปลง
3. ข้อมูลการเติบโตของกล้าไม้หลังเพาะชำ และอัตราการรอดตายของกล้าไม้เพาะชำเดือนที่ 3
ตามที่ บริษัท โรลลิ่ง คอนเซปต์ อินโนเวชั่น จำกัด ได้แจ้งการดำเนินงาน ตามหนังสือที่อ้างถึง 1 ฉบับ ทั้งนี้
ทางบริษัทฯ ได้ดำเนินการตามแผนงาน ตามเอกสารแนบที่ 2 คืออัพเดทการเติบโตของกล้าไม้หลังเพาะชำ และ
อัตราการรอดตายของกล้าไม้เพาะชำเดือนที่ 3 ทั้ง 8 แปลง และการเตรียมไม้หลักหมายแนวปลูก
จึงเรียนมาเพื่อทราบ
(นายจักรพงษ์ เลิศวัฒนาเวช)
กรรมการบริหาร
`;

  const result = extractDocument({
    ocrText: text,
    filename: "ROK-CC-69-06-004 อัพเดทการเติบโตของกล้าไม้หลังเพาะช.pdf",
    documentType: DOCUMENT_TYPE,
  });

  assert.equal(result.fields.documentDate.value, "8 มิถุนายน 2569");
  assert.match(result.fields.subject.value, /เตรียมไม้หลักหมายแนวปลูก$/);
  assert.equal(result.fields.recipient.value, "กรรมการบริหาร ของบริษัท สยาม พีซี เทคโนโลยี จำกัด");
  assert.equal(result.fields.references.value.length, 1);
  assert.equal(result.fields.attachments.value.length, 3);
  assert.equal(result.fields.senderOrganization.value, "บริษัท โรลลิ่ง คอนเซปต์ อินโนเวชั่น จำกัด");
  assert.equal(result.fields.signerName.value, "นายจักรพงษ์ เลิศวัฒนาเวช");
});
