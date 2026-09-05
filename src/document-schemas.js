export const DOCUMENT_SCHEMAS = Object.freeze({
  progress_update_letter: Object.freeze({
    id: "progress_update_letter",
    label: "หนังสืออัปเดตความก้าวหน้า / รายงานผล",
    description:
      "สำหรับหนังสือโต้ตอบที่มีหัวข้อ เรื่อง, เรียน, อ้างถึง, สิ่งที่แนบมาด้วย และส่วนลงนาม",
    fields: Object.freeze([
      Object.freeze({
        key: "documentNumber",
        label: "เลขที่หนังสือ",
        type: "text",
        help: "เช่น ROK-CC-69-06-004",
      }),
      Object.freeze({
        key: "documentDate",
        label: "วันที่หนังสือ",
        type: "text",
        help: "เก็บตามข้อความภาษาไทยในเอกสาร เช่น 4 มิถุนายน 2569",
      }),
      Object.freeze({
        key: "subject",
        label: "เรื่อง",
        type: "textarea",
        help: "หัวเรื่องของหนังสือ ไม่ใช่หัวข้อของเอกสารอ้างถึง",
      }),
      Object.freeze({
        key: "recipient",
        label: "เรียนถึง",
        type: "textarea",
        help: "บุคคลหรือหน่วยงานที่ระบุหลังคำว่า “เรียน”",
      }),
      Object.freeze({
        key: "references",
        label: "อ้างถึง",
        type: "list",
        help: "หนึ่งรายการต่อหนึ่งบรรทัด",
      }),
      Object.freeze({
        key: "attachments",
        label: "สิ่งที่แนบมาด้วย",
        type: "list",
        help: "หนึ่งรายการต่อหนึ่งบรรทัด",
      }),
      Object.freeze({
        key: "senderOrganization",
        label: "หน่วยงาน / บริษัทผู้ส่ง",
        type: "text",
        help: "องค์กรที่ออกหนังสือ",
      }),
      Object.freeze({
        key: "signerName",
        label: "ผู้ลงนาม",
        type: "text",
        help: "ชื่อที่พิมพ์กำกับลายเซ็น",
      }),
      Object.freeze({
        key: "signerPosition",
        label: "ตำแหน่งผู้ลงนาม",
        type: "text",
        help: "ตำแหน่งที่อยู่ถัดจากชื่อผู้ลงนาม",
      }),
      Object.freeze({
        key: "details",
        label: "รายละเอียด / เนื่อหาหลัก",
        type: "textarea",
        help: "ข้อความเนื้อหาที่ OCR อ่านได้ เพื่อให้ผู้ใช้ตรวจและย่อแก้ไขเอง",
      }),
    ]),
  }),
});

export function getDocumentSchema(documentType) {
  return DOCUMENT_SCHEMAS[documentType] ?? null;
}

export function getPublicDocumentTypes() {
  return Object.values(DOCUMENT_SCHEMAS).map((schema) => ({
    id: schema.id,
    label: schema.label,
    description: schema.description,
    fields: schema.fields.map((field) => ({ ...field })),
  }));
}
