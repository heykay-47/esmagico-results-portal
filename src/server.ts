import express, { type ErrorRequestHandler, type Request } from "express";
import { fileURLToPath } from "node:url";
import { analyse, FileError } from "./analyse.ts";
import {
  applyImport,
  getImport,
  getImportProblems,
  getStudent,
  isSortKey,
  listImports,
  listStudents,
  type Db,
} from "./db.ts";
import { todayUtc, type CalendarDate } from "./rules.ts";
import { GRADE_BANDS, PASS_MARK } from "./grading.ts";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const PROBLEMS_IN_RESPONSE = 1000;
const PAGE_SIZES = [10, 25, 50, 100];

const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const tablerDir = fileURLToPath(new URL("../node_modules/@tabler/core/dist", import.meta.url));

type AppOptions = { today?: () => CalendarDate };

/** Error with a status code and a message that is safe to show the administrator. */
class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function intParam(req: Request, name: string, fallback: number): number {
  const raw = req.query[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new HttpError(400, `${name} must be a whole number`);
  return n;
}

function fileNameHeader(req: Request): string {
  const raw = req.get("x-file-name") ?? "upload.csv";
  try {
    return decodeURIComponent(raw).slice(0, 255);
  } catch {
    return raw.slice(0, 255);
  }
}

function csvCell(v: string | number): string {
  const s = String(v);
  // Quote when needed, and defuse spreadsheet formula injection (=, +, -, @).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function createApp(db: Db, options: AppOptions = {}) {
  const today = options.today ?? (() => todayUtc());
  const app = express();
  app.disable("x-powered-by");

  const api = express.Router();

  api.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  api.get("/grading", (_req, res) => {
    res.json({ passMark: PASS_MARK, bands: GRADE_BANDS });
  });

  // The browser sends the file as the raw request body (no multipart), with the
  // original file name in a header.
  api.post("/imports", express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), (req, res) => {
    const bytes: Uint8Array = Buffer.isBuffer(req.body) ? req.body : new Uint8Array();
    const name = fileNameHeader(req);
    const analysis = analyse(bytes, today());
    const summary = applyImport(db, analysis, { name, bytes });
    res.status(201).json({
      ...summary,
      problems: analysis.problems.slice(0, PROBLEMS_IN_RESPONSE),
    });
  });

  api.get("/imports", (_req, res) => {
    res.json({ items: listImports(db) });
  });

  api.get("/imports/:id", (req, res) => {
    const id = Number(req.params.id);
    const summary = Number.isInteger(id) ? getImport(db, id) : null;
    if (!summary) throw new HttpError(404, "That import does not exist.");
    res.json({ ...summary, problems: getImportProblems(db, id)!.slice(0, PROBLEMS_IN_RESPONSE) });
  });

  api.get("/imports/:id/problems.csv", (req, res) => {
    const id = Number(req.params.id);
    const problems = Number.isInteger(id) ? getImportProblems(db, id) : null;
    if (!problems) throw new HttpError(404, "That import does not exist.");
    const lines = [
      ["line", "student_id", "field", "code", "problem"].join(","),
      ...problems.map((p) => [p.line, p.studentId, p.field, p.code, p.message].map(csvCell).join(",")),
    ];
    res.type("text/csv; charset=utf-8");
    res.attachment(`import-${id}-problems.csv`);
    res.send("﻿" + lines.join("\r\n") + "\r\n");
  });

  api.get("/students", (req, res) => {
    const pageSize = intParam(req, "pageSize", 25);
    if (!PAGE_SIZES.includes(pageSize)) throw new HttpError(400, `pageSize must be one of ${PAGE_SIZES.join(", ")}`);
    const page = Math.max(1, intParam(req, "page", 1));
    const grade = req.query.class ? intParam(req, "class", 0) : undefined;
    const section = typeof req.query.section === "string" ? req.query.section.toUpperCase() : undefined;
    const sort = typeof req.query.sort === "string" && isSortKey(req.query.sort) ? req.query.sort : "id";
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : undefined;
    const result = listStudents(db, {
      q,
      gradeLevel: grade,
      section: section || undefined,
      sort,
      desc: req.query.dir === "desc",
      page,
      pageSize,
    });
    res.json({ ...result, page, pageSize });
  });

  api.get("/students/:id", (req, res) => {
    const student = getStudent(db, req.params.id);
    if (!student) throw new HttpError(404, `No student with ID ${req.params.id}.`);
    res.json(student);
  });

  api.use((_req, _res, next) => next(new HttpError(404, "Unknown API endpoint.")));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof FileError) {
      res.status(422).json({ error: err.message, code: err.code });
    } else if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
    } else if (err?.type === "entity.too.large") {
      res.status(413).json({
        error: `The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Split it into smaller files and upload them one at a time.`,
        code: "FILE_TOO_LARGE",
      });
    } else {
      console.error(err);
      res.status(500).json({ error: "Something went wrong on our side. Nothing was changed; please try again." });
    }
  };
  api.use(onError);

  app.use("/api", api);
  app.use("/vendor/tabler", express.static(tablerDir, { maxAge: "7d" }));
  app.use(express.static(publicDir, { index: false }));
  // Single-page app: every other GET serves the shell and the client routes.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile("index.html", { root: publicDir });
  });

  return app;
}
