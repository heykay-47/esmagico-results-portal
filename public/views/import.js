import {
  ApiError,
  api,
  errorAlert,
  fmtBytes,
  fmtDateTime,
  fmtNumber,
  html,
  icon,
  pageHeader,
  plural,
} from "../lib.js";

const MAX_BYTES = 10 * 1024 * 1024;
const PROBLEMS_PER_PAGE = 50;
const REQUIRED = [
  "student_id",
  "full_name",
  "email",
  "date_of_birth",
  "grade_level",
  "section",
  "maths",
  "science",
  "english",
  "social_studies",
  "second_language",
];

const CODE_INFO = {
  MISSING_REQUIRED: { label: "Missing value", color: "orange" },
  INVALID_FORMAT: { label: "Wrong format", color: "red" },
  OUT_OF_RANGE: { label: "Out of range", color: "purple" },
  DUPLICATE_ID: { label: "Duplicate student", color: "azure" },
  WRONG_FIELD_COUNT: { label: "Wrong number of values", color: "pink" },
};

/** POST the file as the raw body; XHR (not fetch) so we can show upload progress. */
function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/imports");
    xhr.setRequestHeader("Content-Type", "text/csv");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(xhr.status, body?.error ?? `The upload failed (error ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new ApiError(0, "Could not reach the server. Check your connection and try again."));
    xhr.send(file);
  });
}

/** Problems we can spot before uploading; null when the file looks fine. */
function precheck(file) {
  if (/\.(xlsx|xls|xlsm|ods|numbers)$/i.test(file.name)) {
    return "This is a spreadsheet file, not a CSV. In your spreadsheet app choose File → Save As → CSV UTF-8, then pick that file.";
  }
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_BYTES) {
    return `This file is ${fmtBytes(file.size)}; the limit is ${fmtBytes(MAX_BYTES)}. Split it into smaller files and upload them one at a time.`;
  }
  return null;
}

export function mountImport(root, { navigate }) {
  const state = {
    file: null,
    phase: "idle", // idle | uploading | processing
    progress: 0,
    precheckError: null,
    // Result panel: { kind: "loading" } | { kind: "result", data } | { kind: "fileError", fileName, message } | { kind: "loadError", message }
    panel: null,
    filter: "",
    page: 1,
    recent: null,
  };

  root.innerHTML = html`
    ${pageHeader({
      pretitle: "Results",
      title: "Import student results",
    })}
    <p class="text-secondary mb-3">
      Upload a CSV exported from your spreadsheet. Valid rows are imported straight away; rows with problems are listed below so you can fix them and upload again.
    </p>
    <div class="row row-cards mb-3">
      <div class="col-lg-7">
        <label class="card card-dropzone h-100 mb-0" id="dropzone" for="file-input">
          <div class="card-body d-flex flex-column align-items-center justify-content-center text-center py-5">
            <span class="avatar avatar-lg bg-primary-lt mb-3">${icon("upload", "icon-lg")}</span>
            <div class="h3 mb-1">Drag and drop a CSV file here</div>
            <div class="text-secondary mb-3">or</div>
            <span class="btn">${icon("file")} Choose file</span>
          </div>
          <input type="file" id="file-input" class="visually-hidden" accept=".csv,text/csv" />
        </label>
      </div>
      <div class="col-lg-5">
        <div class="card h-100" id="upload-panel"></div>
      </div>
    </div>
    <section id="result" aria-live="polite"></section>
    <section id="recent"></section>`;

  const input = root.querySelector("#file-input");
  const dropzone = root.querySelector("#dropzone");
  const uploadPanel = root.querySelector("#upload-panel");
  const resultEl = root.querySelector("#result");
  const recentEl = root.querySelector("#recent");
  let alive = true;

  function selectFile(file) {
    if (state.phase !== "idle") return;
    state.file = file;
    state.precheckError = file ? precheck(file) : null;
    renderUploadPanel();
  }

  input.addEventListener("change", () => selectFile(input.files[0] ?? null));
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("is-dragging");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragging"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-dragging");
    const files = e.dataTransfer?.files;
    if (files?.length > 1) {
      state.file = null;
      state.precheckError = "Drop one file at a time.";
      renderUploadPanel();
      return;
    }
    if (files?.[0]) selectFile(files[0]);
  });

  async function startUpload() {
    const file = state.file;
    if (!file || state.precheckError || state.phase !== "idle") return;
    state.phase = "uploading";
    state.progress = 0;
    renderUploadPanel();
    try {
      const data = await uploadFile(file, (p) => {
        state.progress = p;
        if (p >= 1) state.phase = "processing";
        renderUploadPanel();
      });
      if (!alive) return;
      state.panel = { kind: "result", data };
      state.filter = "";
      state.page = 1;
      // Keep the result in the URL so a reload or the back button shows it again.
      history.replaceState(null, "", `/import?id=${data.id}`);
      loadRecent();
    } catch (err) {
      if (!alive) return;
      state.panel = { kind: "fileError", fileName: file.name, message: err.message };
      history.replaceState(null, "", "/import");
    } finally {
      if (alive) {
        state.phase = "idle";
        state.file = null;
        input.value = "";
        renderUploadPanel();
        renderResult();
        resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }

  function renderUploadPanel() {
    const { file, phase, progress, precheckError } = state;
    const busy = phase !== "idle";
    uploadPanel.innerHTML = html`
      <div class="card-body d-flex flex-column">
        <div class="mb-3">
          <div class="subheader mb-1">Selected file</div>
          ${file
            ? html`<div class="d-flex align-items-center gap-2">${icon("file")}<strong class="text-truncate">${file.name}</strong><span class="text-secondary text-nowrap">(${fmtBytes(file.size)})</span></div>`
            : html`<div class="text-secondary">No file chosen yet</div>`}
        </div>
        ${precheckError ? html`<div class="alert alert-danger py-2" role="alert">${precheckError}</div>` : ""}
        <div class="mb-3 small text-secondary">
          Required columns, in any order:
          <div class="mt-1 d-flex flex-wrap gap-1">${REQUIRED.map((c) => html`<code class="text-nowrap">${c}</code>`)}</div>
          Other columns are ignored. Up to ${fmtBytes(MAX_BYTES)}.
        </div>
        <div class="mt-auto">
          ${busy
            ? html`
                <div class="mb-2 d-flex justify-content-between small">
                  <span>${phase === "uploading" ? "Uploading…" : "Checking rows and saving…"}</span>
                  ${phase === "uploading" ? html`<span>${Math.round(progress * 100)}%</span>` : ""}
                </div>
                <div class="progress mb-3" role="progressbar" aria-label="Upload progress">
                  ${phase === "uploading"
                    ? html`<div class="progress-bar" style="width: ${Math.round(progress * 100)}%"></div>`
                    : html`<div class="progress-bar progress-bar-indeterminate"></div>`}
                </div>`
            : ""}
          <button type="button" class="btn btn-primary w-100" id="upload-btn" ${!file || precheckError || busy ? "disabled" : ""}>
            ${busy ? html`<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Importing…` : html`${icon("upload")} Upload and import`}
          </button>
        </div>
      </div>`;
    uploadPanel.querySelector("#upload-btn").addEventListener("click", startUpload);
  }

  function renderResult() {
    const panel = state.panel;
    if (!panel) {
      resultEl.innerHTML = "";
      return;
    }
    if (panel.kind === "loading") {
      resultEl.innerHTML = html`<div class="card mb-3"><div class="card-body text-center py-5"><div class="spinner-border text-secondary" role="status"></div><div class="text-secondary mt-2">Loading import…</div></div></div>`;
      return;
    }
    if (panel.kind === "loadError") {
      resultEl.innerHTML = errorAlert(panel.message, "retry-result");
      resultEl.querySelector("#retry-result").addEventListener("click", update);
      return;
    }
    if (panel.kind === "fileError") {
      resultEl.innerHTML = html`
        <div class="alert alert-danger mb-3" role="alert">
          <div class="d-flex gap-3">
            ${icon("alert", "alert-icon")}
            <div>
              <h4 class="alert-title">We could not import ${panel.fileName}</h4>
              <div>${panel.message}</div>
              <div class="text-secondary mt-1">Nothing was imported and no existing data was changed.</div>
            </div>
          </div>
        </div>`;
      return;
    }
    resultEl.innerHTML = renderSummary(panel.data) + renderProblems(panel.data);
    wireProblems(panel.data);
  }

  function renderSummary(d) {
    const notes = [];
    if (d.sameFileImportedAt) {
      notes.push(
        html`<div class="alert alert-info mb-2">${icon("info", "alert-icon")} This exact file was already imported on ${fmtDateTime(d.sameFileImportedAt)}. Importing it again is safe: students already in the portal were left as they were.</div>`,
      );
    }
    if (d.ignoredColumns.length) {
      notes.push(
        html`<div class="alert alert-secondary mb-2">${icon("info", "alert-icon")} These columns are not used by the portal and were ignored: ${d.ignoredColumns.map((c) => html`<code class="me-1">${c}</code>`)}</div>`,
      );
    }
    if (d.rowsRead === 0) {
      notes.push(html`<div class="alert alert-warning mb-2">${icon("alert", "alert-icon")} The file has a header row but no student rows.</div>`);
    } else if (d.rejected === 0) {
      notes.push(html`<div class="alert alert-success mb-2">${icon("check", "alert-icon")} Every row was imported. Nothing needs fixing.</div>`);
    }
    const breakdown = [
      d.created ? `${fmtNumber(d.created)} new` : null,
      d.updated ? `${fmtNumber(d.updated)} updated` : null,
      d.unchanged ? `${fmtNumber(d.unchanged)} unchanged` : null,
    ].filter(Boolean);

    return html`
      <div class="d-flex align-items-baseline gap-2 mb-2">
        <h3 class="mb-0">Import result</h3>
        <span class="text-secondary">${d.fileName} · ${fmtDateTime(d.createdAt)}</span>
      </div>
      <div class="row row-cards mb-3">
        <div class="col-sm-4">
          <div class="card card-sm"><div class="card-body">
            <div class="h1 mb-0">${fmtNumber(d.rowsRead)}</div>
            <div class="text-secondary">rows read</div>
          </div></div>
        </div>
        <div class="col-sm-4">
          <div class="card card-sm bg-success-lt"><div class="card-body">
            <div class="h1 mb-0 text-success">${fmtNumber(d.imported)}</div>
            <div class="text-secondary">imported${breakdown.length ? ` (${breakdown.join(", ")})` : ""}</div>
          </div></div>
        </div>
        <div class="col-sm-4">
          <div class="card card-sm ${d.rejected ? "bg-danger-lt" : ""}"><div class="card-body">
            <div class="h1 mb-0 ${d.rejected ? "text-danger" : ""}">${fmtNumber(d.rejected)}</div>
            <div class="text-secondary">rows rejected</div>
          </div></div>
        </div>
      </div>
      ${notes}`;
  }

  function filteredProblems(d) {
    return state.filter ? d.problems.filter((p) => p.code === state.filter) : d.problems;
  }

  function renderProblems(d) {
    if (d.problemCount === 0) return "";
    const counts = {};
    for (const p of d.problems) counts[p.code] = (counts[p.code] ?? 0) + 1;
    const list = filteredProblems(d);
    const pages = Math.max(1, Math.ceil(list.length / PROBLEMS_PER_PAGE));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * PROBLEMS_PER_PAGE;
    const shown = list.slice(start, start + PROBLEMS_PER_PAGE);
    const truncated = d.problemCount > d.problems.length;

    return html`
      <div class="card mt-3 mb-3">
        <div class="card-header">
          <div>
            <h3 class="card-title">Row problems</h3>
            <div class="card-subtitle mb-0">
              ${plural(d.rejected, "row")} could not be imported. Fix them in your spreadsheet and upload the file again; rows already imported will not be duplicated.
            </div>
          </div>
        </div>
        <div class="card-body py-2 border-bottom d-flex flex-wrap gap-2 align-items-center">
          <select class="form-select w-auto" id="problem-filter" aria-label="Filter problems by type">
            <option value="">All problems (${fmtNumber(d.problems.length)})</option>
            ${Object.entries(CODE_INFO)
              .filter(([code]) => counts[code])
              .map(([code, info]) => html`<option value="${code}" ${state.filter === code ? "selected" : ""}>${info.label} (${fmtNumber(counts[code])})</option>`)}
          </select>
          <a class="btn ms-auto" href="/api/imports/${d.id}/problems.csv" download>${icon("download")} Download report (CSV)</a>
        </div>
        ${truncated
          ? html`<div class="card-body py-2 border-bottom small text-secondary">Showing the first ${fmtNumber(d.problems.length)} of ${fmtNumber(d.problemCount)} problems. Download the report to see all of them.</div>`
          : ""}
        <div class="table-responsive">
          <table class="table card-table table-vcenter">
            <thead>
              <tr><th class="w-1">Line</th><th>Student ID</th><th>Column</th><th>Problem</th><th class="w-1">Type</th></tr>
            </thead>
            <tbody>
              ${shown.map(
                (p) => html`<tr>
                  <td class="text-secondary">${p.line}</td>
                  <td>${p.studentId || html`<span class="text-secondary">(blank)</span>`}</td>
                  <td><code>${p.field}</code></td>
                  <td>${p.message}</td>
                  <td><span class="badge bg-${CODE_INFO[p.code].color}-lt text-nowrap" title="${p.code}">${CODE_INFO[p.code].label}</span></td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
        ${pages > 1
          ? html`<div class="card-footer d-flex align-items-center">
              <p class="m-0 text-secondary">Showing ${fmtNumber(start + 1)} to ${fmtNumber(start + shown.length)} of ${fmtNumber(list.length)}</p>
              <ul class="pagination m-0 ms-auto">
                <li class="page-item ${state.page === 1 ? "disabled" : ""}"><button class="page-link" data-page="${state.page - 1}" aria-label="Previous page">${icon("chevronLeft")} Prev</button></li>
                <li class="page-item disabled"><span class="page-link">${state.page} / ${pages}</span></li>
                <li class="page-item ${state.page === pages ? "disabled" : ""}"><button class="page-link" data-page="${state.page + 1}" aria-label="Next page">Next ${icon("chevronRight")}</button></li>
              </ul>
            </div>`
          : ""}
      </div>`;
  }

  function wireProblems(d) {
    resultEl.querySelector("#problem-filter")?.addEventListener("change", (e) => {
      state.filter = e.target.value;
      state.page = 1;
      renderResult();
    });
    resultEl.querySelectorAll("[data-page]").forEach((b) =>
      b.addEventListener("click", () => {
        state.page = Number(b.dataset.page);
        renderResult();
      }),
    );
  }

  async function loadRecent() {
    try {
      const { items } = await api("/imports");
      if (!alive) return;
      state.recent = items;
    } catch {
      state.recent = null;
    }
    renderRecent();
  }

  function renderRecent() {
    const items = state.recent;
    if (!items?.length) {
      recentEl.innerHTML = "";
      return;
    }
    const currentId = state.panel?.kind === "result" ? state.panel.data.id : null;
    recentEl.innerHTML = html`
      <div class="card">
        <div class="card-header"><h3 class="card-title">Recent imports</h3></div>
        <div class="table-responsive">
          <table class="table card-table table-vcenter">
            <thead><tr><th>When</th><th>File</th><th class="text-end">Rows read</th><th class="text-end">Imported</th><th class="text-end">Rejected</th><th class="w-1"></th></tr></thead>
            <tbody>
              ${items.map(
                (i) => html`<tr class="${i.id === currentId ? "table-active" : ""}">
                  <td class="text-nowrap">${fmtDateTime(i.createdAt)}</td>
                  <td class="text-truncate" style="max-width: 16rem">${i.fileName}</td>
                  <td class="text-end">${fmtNumber(i.rowsRead)}</td>
                  <td class="text-end text-success">${fmtNumber(i.imported)}</td>
                  <td class="text-end ${i.rejected ? "text-danger" : ""}">${fmtNumber(i.rejected)}</td>
                  <td><a href="/import?id=${i.id}" data-link class="btn btn-sm">View</a></td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  async function update() {
    const id = new URLSearchParams(location.search).get("id");
    if (!id) {
      state.panel = null;
      renderResult();
      renderRecent();
      return;
    }
    if (state.panel?.kind === "result" && String(state.panel.data.id) === id) return;
    state.panel = { kind: "loading" };
    renderResult();
    try {
      const data = await api(`/imports/${encodeURIComponent(id)}`);
      if (!alive) return;
      state.panel = { kind: "result", data };
      state.filter = "";
      state.page = 1;
    } catch (err) {
      if (!alive) return;
      state.panel = err.status === 404 ? null : { kind: "loadError", message: err.message };
      if (err.status === 404) navigate("/import", { replace: true });
    }
    renderResult();
    renderRecent();
  }

  renderUploadPanel();
  update();
  loadRecent();

  return {
    update,
    destroy: () => {
      alive = false;
    },
  };
}
