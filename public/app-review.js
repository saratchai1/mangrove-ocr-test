async function confirmReviewedData() {
  if (!state.result || !state.schema || state.confirming) return;

  const fields = {};
  for (const control of elements.fieldsContainer.querySelectorAll("[data-field-key]")) {
    const key = control.dataset.fieldKey;
    const type = control.dataset.fieldType;
    fields[key] = type === "list"
      ? control.value.split("\n").map((value) => value.trim()).filter(Boolean)
      : control.value.trim();
  }

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (state.config?.requiresPocToken) {
    headers["X-POC-Access-Token"] = elements.pocToken.value;
  }

  clearMessage();
  setConfirming(true);

  try {
    const response = await fetch("/api/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({
        reviewAcknowledged: true,
        requestId: state.result.requestId,
        documentType: state.schema.id,
        sourceFile: state.result.sourceFile,
        fields,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message || `ยืนยันข้อมูลไม่สำเร็จ (HTTP ${response.status})`);
    }

    state.confirmed = payload;
    elements.confirmedJson.textContent = JSON.stringify(payload, null, 2);
    elements.confirmedCard.hidden = false;
    elements.confirmedCard.scrollIntoView({ behavior: "smooth", block: "start" });
    elements.resultStatus.textContent = "ผู้ใช้ยืนยันแล้ว";
    elements.resultStatus.className = "status-pill status-success";
    setStep(4);
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "ยืนยันข้อมูลไม่สำเร็จ", "error");
  } finally {
    setConfirming(false);
  }
}

function downloadConfirmedJson() {
  if (!state.confirmed) return;
  const blob = new Blob([JSON.stringify(state.confirmed, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const baseName = state.confirmed.sourceFile.name.replace(/\.[^.]+$/, "");
  anchor.href = url;
  anchor.download = `${baseName}-confirmed.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function clearResult() {
  state.result = null;
  state.confirmed = null;
  state.confirming = false;
  elements.emptyResult.hidden = false;
  elements.resultContent.hidden = true;
  elements.resultStatus.textContent = "ยังไม่มีผลลัพธ์";
  elements.resultStatus.className = "status-pill status-neutral";
  elements.fieldsContainer.replaceChildren();
  elements.rawOcrText.textContent = "";
  elements.confirmedCard.hidden = true;
  setConfirming(false);
}

function resetAll() {
  clearMessage();
  clearFile();
  elements.pocToken.value = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}


function setConfirming(confirming) {
  state.confirming = confirming;
  elements.confirmData.disabled = confirming;
  elements.confirmData.textContent = confirming ? "กำลังตรวจและยืนยัน…" : "ยืนยันข้อมูลที่ตรวจแล้ว";
  elements.resetAll.disabled = confirming;
  for (const control of elements.fieldsContainer.querySelectorAll("[data-field-key]")) {
    control.disabled = confirming;
  }
  updateBusyUi();
}

function setLoading(loading) {
  state.loading = loading;
  elements.runOcrLabel.textContent = loading ? "กำลังส่งไฟล์และอ่าน OCR…" : "อ่านเอกสารและเติมข้อมูล";
  elements.runOcrLoader.hidden = !loading;
  updateBusyUi();
}

function updateBusyUi() {
  const busy = state.loading || state.confirming;
  elements.documentType.disabled = busy;
  elements.fileInput.disabled = busy;
  elements.removeFile.disabled = busy;
  elements.pocToken.disabled = busy;
  elements.dropzone.classList.toggle("is-disabled", busy);
  elements.dropzone.setAttribute("aria-disabled", String(busy));
  elements.runOcr.disabled = busy || !canRunOcr();
}

function canRunOcr() {
  return Boolean(state.file && state.schema && state.config?.provider?.configured);
}

function updateRunButton() {
  elements.runOcr.disabled = state.loading || state.confirming || !canRunOcr();
}

function setStep(currentStep) {
  for (const step of document.querySelectorAll(".step")) {
    const number = Number(step.dataset.step);
    step.classList.toggle("is-active", number === currentStep);
    step.classList.toggle("is-complete", number < currentStep);
  }
}

function showMessage(message, type = "error") {
  elements.globalMessage.hidden = false;
  elements.globalMessage.className = `message message-${type}`;
  elements.globalMessage.textContent = message;
}

function clearMessage() {
  elements.globalMessage.hidden = true;
  elements.globalMessage.textContent = "";
}

function normalizedMime(type, filename) {
  const normalized = String(type || "").toLowerCase().split(";")[0].trim();
  if (["application/pdf", "image/jpeg", "image/png"].includes(normalized)) return normalized;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  return "";
}

function friendlyMime(type, filename) {
  const mime = normalizedMime(type, filename);
  if (mime === "application/pdf") return "PDF";
  if (mime === "image/jpeg") return "JPG";
  if (mime === "image/png") return "PNG";
  return mime || "ไฟล์";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("th-TH").format(Number(value) || 0);
}

function confidenceLevel(score) {
  if (score >= 0.82) return "high";
  if (score >= 0.65) return "medium";
  return "low";
}

function confidenceText(score) {
  const percent = Math.round((Number(score) || 0) * 100);
  if (score >= 0.82) return `สูง ${percent}%`;
  if (score >= 0.65) return `กลาง ${percent}%`;
  return `ต่ำ ${percent}%`;
}

function sourceText(source) {
  const labels = {
    ocr: "จาก OCR",
    filename: "จากชื่อไฟล์",
    derived: "ระบบอนุมาน",
    empty: "ไม่พบค่า",
  };
  return labels[source] || source;
}

init().catch((error) => {
  showMessage(error instanceof Error ? error.message : "เปิดหน้า POC ไม่สำเร็จ", "error");
});
