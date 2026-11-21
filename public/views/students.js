import { api, emptyState, errorAlert, fmtNumber, fmtPercent, html, icon, pageHeader } from "../lib.js";

const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULTS = { q: "", class: "", section: "", page: 1, pageSize: 25, sort: "id", dir: "asc" };
const SORTABLE = { id: "Student ID", name: "Name", class: "Class", percentage: "Percentage" };
export const LIST_URL_KEY = "students:lastListUrl";

const GRADE_COLORS = { A: "green", B: "lime", C: "yellow", D: "orange", F: "red" };
export const gradeBadge = (grade) => html`<span class="badge bg-${GRADE_COLORS[grade]}-lt">${grade}</span>`;
export const resultBadge = (passed) =>
  passed ? html`<span class="badge bg-success-lt">Pass</span>` : html`<span class="badge bg-danger-lt">Fail</span>`;

function readQuery() {
  const p = new URLSearchParams(location.search);
  const pageSize = Number(p.get("pageSize"));
  return {
    q: p.get("q") ?? "",
    class: p.get("class") ?? "",
    section: p.get("section") ?? "",
    page: Math.max(1, Number.parseInt(p.get("page") ?? "1", 10) || 1),
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULTS.pageSize,
    sort: SORTABLE[p.get("sort")] ? p.get("sort") : DEFAULTS.sort,
    dir: p.get("dir") === "desc" ? "desc" : "asc",
  };
}

function toSearch(query) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== "" && v !== DEFAULTS[k]) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Page numbers to show, with "…" gaps: 1 … 4 5 6 … 188 */
function pageList(current, last) {
  const pages = new Set([1, last, current - 1, current, current + 1]);
  const sorted = [...pages].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  const out = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push("…");
    out.push(n);
  });
  return out;
}

const skeletonRows = (n) =>
  Array.from(
    { length: n },
    () => html`<tr class="placeholder-glow">
      <td><span class="placeholder col-8"></span></td>
      <td><span class="placeholder col-10"></span></td>
      <td><span class="placeholder col-4"></span></td>
      <td><span class="placeholder col-4"></span></td>
      <td><span class="placeholder col-6"></span></td>
      <td><span class="placeholder col-4"></span></td>
      <td><span class="placeholder col-6"></span></td>
    </tr>`,
  );

export function mountStudents(root, { navigate }) {
  let query = readQuery();
  let data = null; // last successful response
  let controller = null;
  let debounce = null;

  root.innerHTML = html`
    ${pageHeader({
      pretitle: "Results",
      title: "Students",
      actions: html`<a href="/import" data-link class="btn btn-primary">${icon("upload")} Import CSV</a>`,
    })}
    <div class="card">
      <div class="card-body border-bottom py-3">
        <div class="row g-2">
          <div class="col-md">
            <div class="input-icon">
              <span class="input-icon-addon">${icon("search")}</span>
              <input type="search" id="q" class="form-control" placeholder="Search by name or student ID" aria-label="Search by name or student ID" autocomplete="off" maxlength="100" />
            </div>
          </div>
          <div class="col-6 col-md-auto">
            <select id="class" class="form-select" aria-label="Filter by class">
              <option value="">All classes</option>
              ${Array.from({ length: 12 }, (_, i) => html`<option value="${i + 1}">Class ${i + 1}</option>`)}
            </select>
          </div>
          <div class="col-6 col-md-auto">
            <select id="section" class="form-select" aria-label="Filter by section">
              <option value="">All sections</option>
              ${["A", "B", "C", "D", "E", "F"].map((s) => html`<option value="${s}">Section ${s}</option>`)}
            </select>
          </div>
        </div>
      </div>
      <div id="list"></div>
    </div>`;

  const qInput = root.querySelector("#q");
  const classSelect = root.querySelector("#class");
  const sectionSelect = root.querySelector("#section");
  const listEl = root.querySelector("#list");

  function syncControls() {
    if (document.activeElement !== qInput) qInput.value = query.q;
    classSelect.value = query.class;
    sectionSelect.value = query.section;
  }

  function setQuery(changes, { replace = false } = {}) {
    const next = { ...query, ...changes };
    // Any change other than paging sends you back to page 1.
    if (!("page" in changes)) next.page = 1;
    navigate(`/students${toSearch(next)}`, { replace });
  }

  qInput.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => setQuery({ q: qInput.value.trim() }, { replace: true }), 250);
  });
  classSelect.addEventListener("change", () => setQuery({ class: classSelect.value }));
  sectionSelect.addEventListener("change", () => setQuery({ section: sectionSelect.value }));

  listEl.addEventListener("click", (e) => {
    const target = e.target.closest("[data-action]");
    if (!target) return;
    const { action } = target.dataset;
    if (action === "page") setQuery({ page: Number(target.dataset.page) });
    if (action === "sort") {
      const key = target.dataset.sort;
      setQuery({ sort: key, dir: query.sort === key && query.dir === "asc" ? "desc" : "asc" });
    }
    if (action === "clear") {
      qInput.value = "";
      setQuery({ q: "", class: "", section: "" });
    }
    if (action === "retry") load();
  });
  listEl.addEventListener("change", (e) => {
    if (e.target.id === "page-size") setQuery({ pageSize: Number(e.target.value) });
  });

  const sortHeader = (key) => {
    const active = query.sort === key;
    return html`<th aria-sort="${active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}">
      <button type="button" class="table-sort-btn ${active ? "active" : ""}" data-action="sort" data-sort="${key}">
        ${SORTABLE[key]} ${active ? icon(query.dir === "asc" ? "sortAsc" : "sortDesc", "icon-sm") : ""}
      </button>
    </th>`;
  };

  const tableHead = () => html`
    <thead>
      <tr>
        ${sortHeader("id")}
        ${sortHeader("name")}
        ${sortHeader("class")}
        <th>Section</th>
        ${sortHeader("percentage")}
        <th>Grade</th>
        <th>Result</th>
      </tr>
    </thead>`;

  function renderLoading() {
    if (data) {
      // Keep the current rows visible and dim them while the next page loads.
      listEl.querySelector("table")?.classList.add("is-loading");
      return;
    }
    listEl.innerHTML = html`<div class="table-responsive"><table class="table card-table table-vcenter">${tableHead()}<tbody>${skeletonRows(8)}</tbody></table></div>`;
  }

  function renderError(message) {
    listEl.innerHTML = html`<div class="card-body">${errorAlert(message)}</div>`;
    listEl.querySelector("#retry").dataset.action = "retry";
  }

  function renderList() {
    const filtered = query.q || query.class || query.section;
    if (data.total === 0 && !filtered) {
      listEl.innerHTML = emptyState({
        iconName: "users",
        title: "No students yet",
        subtitle: "Import a CSV of term results and the students will appear here.",
        action: html`<a href="/import" data-link class="btn btn-primary">${icon("upload")} Import CSV</a>`,
      });
      return;
    }
    if (data.total === 0) {
      const what = query.q ? `“${query.q}”` : "these filters";
      listEl.innerHTML = emptyState({
        iconName: "search",
        title: `No students match ${what}`,
        subtitle: "Check the spelling, search by student ID, or clear the filters.",
        action: html`<button type="button" class="btn" data-action="clear">${icon("x")} Clear search and filters</button>`,
      });
      return;
    }

    const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
    const from = (data.page - 1) * data.pageSize + 1;
    const to = from + data.items.length - 1;
    listEl.innerHTML = html`
      <div class="table-responsive">
        <table class="table card-table table-vcenter table-hover">
          ${tableHead()}
          <tbody>
            ${data.items.map(
              (s) => html`<tr>
                <td><a href="/students/${encodeURIComponent(s.studentId)}" data-link class="text-reset">${s.studentId}</a></td>
                <td><a href="/students/${encodeURIComponent(s.studentId)}" data-link class="fw-medium">${s.fullName}</a></td>
                <td>${s.gradeLevel}</td>
                <td>${s.section}</td>
                <td>${fmtPercent(s.percentage)}</td>
                <td>${gradeBadge(s.grade)}</td>
                <td>${resultBadge(s.passed)}</td>
              </tr>`,
            )}
            ${data.items.length === 0
              ? html`<tr><td colspan="7" class="text-center text-secondary py-4">This page is past the end of the list. <button type="button" class="btn btn-link p-0 align-baseline" data-action="page" data-page="${lastPage}">Go to the last page</button></td></tr>`
              : ""}
          </tbody>
        </table>
      </div>
      <div class="card-footer d-flex flex-wrap align-items-center gap-2">
        <p class="m-0 text-secondary">
          ${data.items.length ? html`Showing ${fmtNumber(from)} to ${fmtNumber(to)} of ` : ""}${fmtNumber(data.total)} ${data.total === 1 ? "student" : "students"}
        </p>
        <ul class="pagination m-0 ms-auto" aria-label="Pages">
          <li class="page-item ${data.page <= 1 ? "disabled" : ""}">
            <button type="button" class="page-link" data-action="page" data-page="${data.page - 1}" aria-label="Previous page">${icon("chevronLeft")} Previous</button>
          </li>
          ${pageList(data.page, lastPage).map((n) =>
            n === "…"
              ? html`<li class="page-item disabled"><span class="page-link">…</span></li>`
              : html`<li class="page-item ${n === data.page ? "active" : ""}">
                  <button type="button" class="page-link" data-action="page" data-page="${n}" aria-label="Page ${n}" ${n === data.page ? html`aria-current="page"` : ""}>${n}</button>
                </li>`,
          )}
          <li class="page-item ${data.page >= lastPage ? "disabled" : ""}">
            <button type="button" class="page-link" data-action="page" data-page="${data.page + 1}" aria-label="Next page">Next ${icon("chevronRight")}</button>
          </li>
        </ul>
        <div class="d-flex align-items-center gap-2">
          <label for="page-size" class="text-secondary text-nowrap">Rows per page</label>
          <select id="page-size" class="form-select form-select-sm w-auto">
            ${PAGE_SIZES.map((n) => html`<option value="${n}" ${n === data.pageSize ? "selected" : ""}>${n}</option>`)}
          </select>
        </div>
      </div>`;
  }

  async function load() {
    controller?.abort();
    controller = new AbortController();
    renderLoading();
    const params = new URLSearchParams({ page: query.page, pageSize: query.pageSize, sort: query.sort, dir: query.dir });
    if (query.q) params.set("q", query.q);
    if (query.class) params.set("class", query.class);
    if (query.section) params.set("section", query.section);
    try {
      data = await api(`/students?${params}`, { signal: controller.signal });
      renderList();
    } catch (err) {
      if (err.name === "AbortError") return;
      data = null;
      renderError(err.message);
    }
  }

  function update() {
    query = readQuery();
    sessionStorage.setItem(LIST_URL_KEY, location.pathname + location.search);
    syncControls();
    load();
  }

  update();
  return {
    update,
    destroy: () => {
      clearTimeout(debounce);
      controller?.abort();
    },
  };
}
