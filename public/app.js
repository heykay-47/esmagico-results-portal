// Client-side router. Each view is mount(root, ctx) → optional { destroy, update }.
// update() runs when only the query string changes (search, paging), so the view
// can refetch without being rebuilt.
import { mountImport } from "./views/import.js";
import { mountStudents } from "./views/students.js";
import { mountReport } from "./views/report.js";
import { emptyState, html, icon } from "./lib.js";

const routes = [
  { pattern: /^\/$/, redirect: "/students" },
  { pattern: /^\/import\/?$/, nav: "/import", title: "Import", mount: mountImport },
  { pattern: /^\/students\/?$/, nav: "/students", title: "Students", mount: mountStudents },
  { pattern: /^\/students\/([^/]+)\/?$/, nav: "/students", title: "Student report", mount: mountReport },
];

const root = document.getElementById("app");
let view = null;
let currentPath = null;

export function navigate(url, { replace = false } = {}) {
  history[replace ? "replaceState" : "pushState"](null, "", url);
  render();
}

function mountNotFound(el) {
  el.innerHTML = emptyState({
    iconName: "info",
    title: "Page not found",
    subtitle: "There is nothing at this address.",
    action: html`<a href="/students" data-link class="btn btn-primary">${icon("users")} Go to students</a>`,
  });
}

function render() {
  const path = location.pathname;
  const route = routes.find((r) => r.pattern.test(path));
  if (route?.redirect) return navigate(route.redirect, { replace: true });

  // Query-only changes (search, paging) are handled inside the view itself.
  if (path === currentPath && view?.update) {
    view.update();
    return;
  }
  view?.destroy?.();
  view = null;
  currentPath = path;

  document.querySelectorAll("[data-nav]").forEach((li) => {
    const active = route?.nav === li.dataset.nav;
    li.classList.toggle("active", active);
    li.querySelector("a").toggleAttribute("aria-current", active);
  });
  document.title = `${route?.title ?? "Not found"} · Results Portal`;
  root.innerHTML = "";
  window.scrollTo(0, 0);

  if (!route) return mountNotFound(root);
  const params = path.match(route.pattern).slice(1).map(decodeURIComponent);
  view = route.mount(root, { params, navigate }) ?? null;
}

// Intercept same-origin links marked data-link so navigation stays in the app.
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
  e.preventDefault();
  navigate(a.getAttribute("href"));
});
window.addEventListener("popstate", render);

render();
