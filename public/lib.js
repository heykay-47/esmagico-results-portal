// Small helpers shared by the views: escaped HTML templates, API calls, formatting.

class Raw {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

/** Mark a string as already-safe HTML. Only use for markup we wrote ourselves. */
export const raw = (value) => new Raw(value);

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (s) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function renderValue(v) {
  if (v === null || v === undefined || v === false) return "";
  if (Array.isArray(v)) return v.map(renderValue).join("");
  if (v instanceof Raw) return v.value;
  return escape(String(v));
}

/** Tagged template: every interpolated value is HTML-escaped unless wrapped in raw(). */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += renderValue(v) + strings[i + 1];
  });
  return raw(out);
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Fetch JSON from the API. Throws ApiError with a message fit to show the user. */
export async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, options);
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `The server answered with an error (${res.status}).`);
  return body;
}

const numberFormat = new Intl.NumberFormat("en-IN");
export const fmtNumber = (n) => numberFormat.format(n);
export const fmtPercent = (n) => `${n.toFixed(1)}%`;
export const fmtMark = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

export function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const plural = (n, one, many = `${one}s`) => `${fmtNumber(n)} ${n === 1 ? one : many}`;

// Tabler Icons (MIT), inlined so nothing loads from a CDN.
const ICON_PATHS = {
  search: '<path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" /><path d="M21 21l-6 -6" />',
  upload: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" /><path d="M7 9l5 -5l5 5" /><path d="M12 4l0 12" />',
  download: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" /><path d="M7 11l5 5l5 -5" /><path d="M12 4l0 12" />',
  file: '<path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />',
  chevronLeft: '<path d="M15 6l-6 6l6 6" />',
  chevronRight: '<path d="M9 6l6 6l-6 6" />',
  arrowLeft: '<path d="M5 12l14 0" /><path d="M5 12l6 6" /><path d="M5 12l6 -6" />',
  printer: '<path d="M17 17h2a2 2 0 0 0 2 -2v-4a2 2 0 0 0 -2 -2h-14a2 2 0 0 0 -2 2v4a2 2 0 0 0 2 2h2" /><path d="M17 9v-4a2 2 0 0 0 -2 -2h-6a2 2 0 0 0 -2 2v4" /><path d="M7 13m0 2a2 2 0 0 1 2 -2h6a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2z" />',
  users: '<path d="M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" /><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /><path d="M21 21v-2a4 4 0 0 0 -3 -3.85" />',
  userOff: '<path d="M8.18 8.189a4.01 4.01 0 0 0 2.616 2.627m3.507 -.545a4 4 0 1 0 -5.59 -5.552" /><path d="M6 21v-2a4 4 0 0 1 4 -4h4c.412 0 .81 .062 1.183 .178m2.633 2.618c.12 .38 .184 .785 .184 1.204v2" /><path d="M3 3l18 18" />',
  alert: '<path d="M12 9v4" /><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" /><path d="M12 16h.01" />',
  check: '<path d="M5 12l5 5l10 -10" />',
  info: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path d="M12 9h.01" /><path d="M11 12h1v4h1" />',
  refresh: '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />',
  x: '<path d="M18 6l-12 12" /><path d="M6 6l12 12" />',
  sortAsc: '<path d="M6 15l6 -6l6 6" />',
  sortDesc: '<path d="M6 9l6 6l6 -6" />',
};

export function icon(name, extraClass = "") {
  return raw(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon ${extraClass}" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`,
  );
}

/** Friendly alert for a failed request, with a Retry button wired by the caller. */
export const errorAlert = (message, retryId = "retry") => html`
  <div class="alert alert-danger" role="alert">
    <div class="d-flex align-items-center gap-3">
      ${icon("alert", "alert-icon")}
      <div class="flex-fill">
        <h4 class="alert-title">Something went wrong</h4>
        <div class="text-secondary">${message}</div>
      </div>
      <button type="button" class="btn btn-outline-danger" id="${retryId}">${icon("refresh")} Retry</button>
    </div>
  </div>`;

export const emptyState = ({ iconName, title, subtitle, action }) => html`
  <div class="empty">
    <div class="empty-icon">${icon(iconName)}</div>
    <p class="empty-title">${title}</p>
    <p class="empty-subtitle text-secondary">${subtitle}</p>
    ${action ? html`<div class="empty-action">${action}</div>` : ""}
  </div>`;

export const pageHeader = ({ pretitle, title, actions }) => html`
  <div class="page-header d-print-none mt-0 mb-3">
    <div class="row g-2 align-items-center">
      <div class="col">
        ${pretitle ? html`<div class="page-pretitle">${pretitle}</div>` : ""}
        <h2 class="page-title">${title}</h2>
      </div>
      ${actions ? html`<div class="col-auto ms-auto"><div class="btn-list">${actions}</div></div>` : ""}
    </div>
  </div>`;
