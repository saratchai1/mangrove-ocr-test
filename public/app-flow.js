async function init() {
  bindEvents();
  const response = await fetch("/api/config", { headers: { Accept: "application/json" } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "โหลดการตั้งค่าระบบไม่สำเร็จ");

  state.config = payload;
  populateDocumentTypes(payload.documentTypes || []);
  updateProviderUi();
  updateUploadLimit();
  updateRunButton();
}

function bindEvents() {
  elements.documentType.addEventListener("change", () => {
    state.schema = findSelectedSchema();
    elements.documentTypeHelp.textContent = state.schema?.description || "";
    clearResult();
    updateRunButton();
  });

  elements.dropzone.addEventListener("click", () => elements.fileInput.click());
  elements.dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      elements.fileInput.click();
    }
  });

  for (const eventName of ["dragenter", "dragover"]) {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.classList.remove("is-dragging");
    });
  }
  elements.dropzone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) selectFile(file);
  });

  elements.fileInput.addEventListener("change", () => {
    const file = elements.fileInput.files?.[0];
    if (file) selectFile(file);
  });

  elements.removeFile.addEventListener("click", () => clearFile());
  elements.runOcr.addEventListener("click", () => runOcr());
  elements.resetAll.addEventListener("click", () => resetAll());
  elements.confirmData.addEventListener("click", () => confirmReviewedData());
  elements.downloadJson.addEventListener("click", () => downloadConfirmedJson());
}

function populateDocumentTypes(documentTypes) {
  elements.documentType.replaceChildren();
  for (const documentType of documentTypes) {
    const option = document.createElement("option");
    option.value = documentType.id;
    option.textContent = documentType.label;
    elements.documentType.append(option);
  }
  state.schema = findSelectedSchema();
  elements.documentTypeHelp.textContent = state.schema?.description || "";
}

function findSelectedSchema() {
  return state.config?.documentTypes?.find((item) => item.id === elements.documentType.value) || null;
}

function updateProviderUi() {
  const configured = Boolean(state.config?.provider?.configured);
  elements.providerStatus.textContent = configured ? "OCR API พร้อมใช้งาน" : "ยังไม่ตั้ง API key";
  elements.providerStatus.className = `status-pill ${configured ? "status-success" : "status-warning"}`;
  elements.footerProvider.textContent = `OCR provider: ${state.config?.provider?.label || "ไม่ทราบ"}`;
  elements.pocTokenField.hidden = !state.config?.requiresPocToken;

  if (!configured) {
    showMessage("ตั้ง OCR_SPACE_API_KEY ด้วย Worker secret ก่อนเริ่มทดสอบไฟล์จริง", "warning");
  }
}

function updateUploadLimit() {
  const max = state.config?.upload?.maxFileBytes || 0;
  elements.fileLimitText.textContent = `รองรับ PDF, JPG และ PNG สูงสุด ${formatBytes(max)}`;
}

function selectFile(file) {
  if (state.loading || state.confirming) return;
  clearMessage();
  const validationError = validateFile(file);
  if (validationError) {
    showMessage(validationError, "error");
    return;
  }

  clearFilePreview();
  state.file = file;
  elements.selectedFile.hidden = false;
  elements.selectedFileName.textContent = file.name;
  elements.selectedFileMeta.textContent = `${friendlyMime(file.type, file.name)} · ${formatBytes(file.size)}`;
  elements.fileInput.value = "";
  renderPreview(file);
  clearResult();
  setStep(2);
  updateRunButton();
}

function validateFile(file) {
  const allowed = state.config?.upload?.acceptedMimeTypes || [];
  const inferred = normalizedMime(file.type, file.name);
  if (!allowed.includes(inferred)) return "ชนิดไฟล์ไม่รองรับ กรุณาใช้ PDF, JPG หรือ PNG";
  if (file.size <= 0) return "ไฟล์ว่างเปล่า";
  if (file.size > state.config.upload.maxFileBytes) {
    return `ไฟล์ใหญ่เกิน ${formatBytes(state.config.upload.maxFileBytes)}`;
  }
  return "";
}

function renderPreview(file) {
  state.previewUrl = URL.createObjectURL(file);
  elements.previewFrame.hidden = false;
  elements.previewFrame.replaceChildren();

  if (normalizedMime(file.type, file.name) === "application/pdf") {
    const frame = document.createElement("iframe");
    frame.src = state.previewUrl;
    frame.title = `ตัวอย่าง ${file.name}`;
    elements.previewFrame.append(frame);
    return;
  }

  const image = document.createElement("img");
  image.src = state.previewUrl;
  image.alt = `ตัวอย่าง ${file.name}`;
  elements.previewFrame.append(image);
}

function clearFilePreview() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  elements.previewFrame.replaceChildren();
  elements.previewFrame.hidden = true;
}

function clearFile() {
  clearFilePreview();
  state.file = null;
  elements.selectedFile.hidden = true;
  elements.selectedFileName.textContent = "";
  elements.selectedFileMeta.textContent = "";
  elements.fileInput.value = "";
  clearResult();
  setStep(1);
  updateRunButton();
}

async function runOcr() {
  if (!state.file || !state.schema || state.loading || state.confirming) return;
  if (state.config?.requiresPocToken && !elements.pocToken.value.trim()) {
    showMessage("กรุณากรอกรหัสสำหรับทดสอบ POC", "error");
    elements.pocToken.focus();
    return;
  }

  clearMessage();
  setLoading(true);

  const file = state.file;
  const schema = state.schema;
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("documentType", schema.id);

  const headers = { Accept: "application/json" };
  if (state.config?.requiresPocToken) {
    headers["X-POC-Access-Token"] = elements.pocToken.value;
  }

  try {
    const response = await fetch("/api/ocr", {
      method: "POST",
      headers,
      body: formData,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message || `OCR ไม่สำเร็จ (HTTP ${response.status})`);
    }

    state.result = payload;
    renderResult(payload);
    setStep(3);
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "OCR ไม่สำเร็จ", "error");
    elements.resultStatus.textContent = "OCR ไม่สำเร็จ";
    elements.resultStatus.className = "status-pill status-error";
  } finally {
    setLoading(false);
  }
}

function renderResult(result) {
  elements.emptyResult.hidden = true;
  elements.resultContent.hidden = false;
  elements.resultStatus.textContent = `อ่านได้ ${result.pageCount} หน้า`;
  elements.resultStatus.className = "status-pill status-success";

  elements.resultMeta.replaceChildren(
    metaItem("Request ID", result.requestId),
    metaItem("เวลา OCR", `${formatNumber(result.processingTimeMs)} ms`),
    metaItem("ความมั่นใจเฉลี่ย", confidenceText(result.overallConfidence)),
    metaItem("การบันทึก", "ยังไม่บันทึก"),
  );

  renderWarnings(result.warnings || []);
  renderFields(result.fields || {});
  elements.rawOcrText.textContent = result.ocrText || "";
  elements.confirmedCard.hidden = true;
  state.confirmed = null;
}

function metaItem(label, value) {
  const item = document.createElement("div");
  const key = document.createElement("span");
  const content = document.createElement("strong");
  key.textContent = label;
  content.textContent = value;
  item.append(key, content);
  return item;
}

function renderWarnings(warnings) {
  elements.warningList.replaceChildren();
  elements.warningBox.hidden = warnings.length === 0;
  for (const warning of warnings) {
    const item = document.createElement("li");
    item.textContent = warning;
    elements.warningList.append(item);
  }
}

function renderFields(fields) {
  elements.fieldsContainer.replaceChildren();

  for (const definition of state.schema?.fields || []) {
    const result = fields[definition.key] || { value: "", confidence: 0, source: "empty", evidence: "" };
    const wrapper = document.createElement("div");
    wrapper.className = `review-field ${definition.type === "textarea" || definition.type === "list" ? "field-wide" : ""}`;

    const labelRow = document.createElement("div");
    labelRow.className = "field-label-row";
    const label = document.createElement("label");
    const controlId = `field-${definition.key}`;
    label.htmlFor = controlId;
    label.textContent = definition.label;

    const confidence = document.createElement("span");
    confidence.className = `confidence-chip confidence-${confidenceLevel(result.confidence)}`;
    confidence.textContent = `${confidenceText(result.confidence)} · ${sourceText(result.source)}`;
    labelRow.append(label, confidence);

    const control = definition.type === "textarea" || definition.type === "list"
      ? document.createElement("textarea")
      : document.createElement("input");
    control.id = controlId;
    control.dataset.fieldKey = definition.key;
    control.dataset.fieldType = definition.type;
    control.autocomplete = "off";
    control.value = Array.isArray(result.value) ? result.value.join("\n") : result.value || "";
    if (control instanceof HTMLTextAreaElement) {
      control.rows = definition.key === "details" ? 8 : definition.type === "list" ? 4 : 3;
    }

    const help = document.createElement("small");
    help.textContent = definition.help || "";

    wrapper.append(labelRow, control, help);

    if (result.evidence) {
      const evidence = document.createElement("details");
      evidence.className = "evidence";
      const summary = document.createElement("summary");
      summary.textContent = "ดูข้อความที่ใช้เติมช่องนี้";
      const pre = document.createElement("pre");
      pre.textContent = result.evidence;
      evidence.append(summary, pre);
      wrapper.append(evidence);
    }

    elements.fieldsContainer.append(wrapper);
  }
}

