import { api, emptyState, errorAlert, fmtDate, fmtDateTime, fmtMark, fmtPercent, html, icon } from "../lib.js";
import { LIST_URL_KEY, gradeBadge, resultBadge } from "./students.js";

const SUBJECT_LABELS = {
  maths: "Maths",
  science: "Science",
  english: "English",
  social_studies: "Social studies",
  second_language: "Second language",
};

const initials = (name) =>
  name
    .replace(/,/g, " ")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

function ageOn(dobIso, now = new Date()) {
  const [y, m, d] = dobIso.split("-").map(Number);
  const hadBirthday = now.getMonth() + 1 > m || (now.getMonth() + 1 === m && now.getDate() >= d);
  return now.getFullYear() - y - (hadBirthday ? 0 : 1);
}

export function mountReport(root, { params }) {
  const [id] = params;
  const backUrl = sessionStorage.getItem(LIST_URL_KEY) ?? "/students";
  let alive = true;
  let grading = null;

  const backLink = html`<a href="${backUrl}" data-link class="d-inline-flex align-items-center gap-1 mb-3 d-print-none">${icon("arrowLeft", "icon-sm")} Back to students</a>`;

  function renderLoading() {
    root.innerHTML = html`${backLink}
      <div class="row row-cards placeholder-glow" aria-busy="true">
        <div class="col-lg-8"><div class="card"><div class="card-body d-flex gap-3">
          <span class="avatar avatar-xl placeholder"></span>
          <div class="flex-fill"><div class="placeholder col-6 mb-2"></div><div class="placeholder placeholder-xs col-8"></div><div class="placeholder placeholder-xs col-5"></div></div>
        </div></div></div>
        <div class="col-lg-4"><div class="card"><div class="card-body"><div class="placeholder col-8 mb-2"></div><div class="placeholder col-5"></div></div></div></div>
        <div class="col-12"><div class="card"><div class="card-body">${Array.from({ length: 5 }, () => html`<div class="placeholder col-12 mb-3"></div>`)}</div></div></div>
      </div>`;
  }

  function renderNotFound() {
    document.title = "Student not found · Results Portal";
    root.innerHTML = html`${backLink}
      <div class="card"><div class="card-body">
        ${emptyState({
          iconName: "userOff",
          title: "Student not found",
          subtitle: `There is no student with ID “${id}”. They may not have been imported yet, or their row was rejected during import.`,
          action: html`<div class="btn-list justify-content-center">
            <a href="/students" data-link class="btn btn-primary">${icon("users")} Back to students</a>
            <a href="/import" data-link class="btn">${icon("upload")} Go to import</a>
          </div>`,
        })}
      </div></div>`;
  }

  function renderError(message) {
    root.innerHTML = html`${backLink}${errorAlert(message)}`;
    root.querySelector("#retry").addEventListener("click", load);
  }

  function render(s) {
    const r = s.result;
    document.title = `${s.fullName} · Results Portal`;
    const failed = new Set(r.failedSubjects);
    root.innerHTML = html`${backLink}
      <div class="row row-cards mb-3">
        <div class="col-lg-8">
          <div class="card h-100">
            <div class="card-body d-flex align-items-center gap-3">
              <span class="avatar avatar-xl" aria-hidden="true">${initials(s.fullName)}</span>
              <div class="min-w-0">
                <h2 class="mb-1">${s.fullName}</h2>
                <div class="text-secondary">${s.studentId} · Class ${s.gradeLevel}, Section ${s.section}</div>
                <div class="text-secondary">${s.email}</div>
                <div class="text-secondary">Date of birth: ${fmtDate(s.dateOfBirth)} (age ${ageOn(s.dateOfBirth)})</div>
              </div>
            </div>
          </div>
        </div>
        <div class="col-lg-4">
          <div class="card h-100 ${r.passed ? "card-result-pass" : "card-result-fail"}">
            <div class="card-body">
              <div class="d-flex align-items-start justify-content-between">
                <div>
                  <div class="subheader">Overall</div>
                  <div class="d-flex align-items-baseline gap-2">
                    <span class="display-6 fw-bold">${fmtPercent(r.percentage)}</span>
                    <span class="h2 mb-0" aria-label="Grade ${r.grade}">${r.grade}</span>
                  </div>
                  <div class="fw-medium">Total: ${fmtMark(r.total)} / ${r.maxTotal}</div>
                </div>
                <span class="badge ${r.passed ? "bg-success" : "bg-danger"} text-white fs-4 px-3 py-2">${r.passed ? "PASS" : "FAIL"}</span>
              </div>
              ${r.passed
                ? ""
                : html`<div class="text-danger small mt-2">Below the pass mark of ${grading?.passMark ?? 33} in ${r.failedSubjects.map((k) => SUBJECT_LABELS[k]).join(", ")}.</div>`}
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Marks by subject</h3>
          <div class="card-actions d-print-none">
            <button type="button" class="btn" id="print">${icon("printer")} Print report</button>
          </div>
        </div>
        <div class="table-responsive">
          <table class="table card-table table-vcenter">
            <thead><tr><th>Subject</th><th class="w-1 text-nowrap">Marks (out of 100)</th><th class="d-none d-sm-table-cell"><span class="visually-hidden">Bar</span></th><th class="w-1">Result</th></tr></thead>
            <tbody>
              ${Object.entries(s.marks).map(
                ([key, mark]) => html`<tr>
                  <td>${SUBJECT_LABELS[key]}</td>
                  <td class="fw-medium">${fmtMark(mark)}</td>
                  <td class="d-none d-sm-table-cell w-50">
                    <div class="progress progress-sm" role="img" aria-label="${fmtMark(mark)} out of 100">
                      <div class="progress-bar ${failed.has(key) ? "bg-danger" : ""}" style="width: ${mark}%"></div>
                    </div>
                  </td>
                  <td>${failed.has(key) ? html`<span class="badge bg-danger-lt">Below pass</span>` : html`<span class="badge bg-success-lt">Pass</span>`}</td>
                </tr>`,
              )}
            </tbody>
            <tfoot>
              <tr class="fw-bold"><td>Total</td><td class="text-nowrap">${fmtMark(r.total)} / ${r.maxTotal}</td><td class="d-none d-sm-table-cell"></td><td>${resultBadge(r.passed)}</td></tr>
            </tfoot>
          </table>
        </div>
        <div class="card-footer small text-secondary">
          ${grading
            ? html`Grading: ${grading.bands.map((b, i) => html`${i ? " · " : ""}${gradeBadge(b.grade)} ${b.min > 0 ? `${b.min}% and above` : "below " + grading.bands[i - 1].min + "%"}`)}.
                Pass requires at least ${grading.passMark} in every subject.`
            : ""}
          <span class="d-block mt-1">Last updated by an import on ${fmtDateTime(s.updatedAt)}.</span>
        </div>
      </div>`;
    root.querySelector("#print").addEventListener("click", () => window.print());
  }

  async function load() {
    renderLoading();
    try {
      const [student, scheme] = await Promise.all([api(`/students/${encodeURIComponent(id)}`), grading ?? api("/grading")]);
      grading = scheme;
      if (alive) render(student);
    } catch (err) {
      if (!alive) return;
      if (err.status === 404) renderNotFound();
      else renderError(err.message);
    }
  }

  load();
  return {
    destroy: () => {
      alive = false;
    },
  };
}
