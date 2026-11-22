// SQLite persistence (node:sqlite, no native build step).

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Analysis, RowProblem } from "./analyse.ts";
import { SUBJECTS, type Marks, type StudentRecord } from "./rules.ts";
import { computeResult, type Result } from "./grading.ts";

export const SUBJECT_COLS = SUBJECTS.map((s) => s.key);

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS students (
  student_id      TEXT PRIMARY KEY,
  full_name       TEXT NOT NULL,
  name_search     TEXT NOT NULL,
  email           TEXT NOT NULL,
  date_of_birth   TEXT NOT NULL,
  grade_level     INTEGER NOT NULL CHECK (grade_level BETWEEN 1 AND 12),
  section         TEXT NOT NULL CHECK (section BETWEEN 'A' AND 'F'),
  ${SUBJECT_COLS.map((c) => `${c} REAL NOT NULL CHECK (${c} BETWEEN 0 AND 100)`).join(",\n  ")},
  total           REAL GENERATED ALWAYS AS (${SUBJECT_COLS.join(" + ")}) STORED,
  import_id       INTEGER NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS students_class ON students (grade_level, section);
CREATE INDEX IF NOT EXISTS students_name ON students (name_search);
CREATE INDEX IF NOT EXISTS students_total ON students (total);

CREATE TABLE IF NOT EXISTS imports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name       TEXT NOT NULL,
  file_size       INTEGER NOT NULL,
  file_sha256     TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  rows_read       INTEGER NOT NULL,
  created         INTEGER NOT NULL,
  updated         INTEGER NOT NULL,
  unchanged       INTEGER NOT NULL,
  rejected        INTEGER NOT NULL,
  ignored_columns TEXT NOT NULL,
  problems        TEXT NOT NULL
);
`;

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

// Letters that NFD does not split into base letter + accent.
const FOLD: Record<string, string> = { ø: "o", æ: "ae", œ: "oe", ß: "ss", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i" };

/** Lower case with accents removed, so "jose" finds "José" and "soren" finds "Søren". */
export function searchKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[øæœßłđðþı]/g, (c) => FOLD[c]);
}

export type ImportSummary = {
  id: number;
  fileName: string;
  fileSize: number;
  createdAt: string;
  rowsRead: number;
  imported: number;
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  problemCount: number;
  ignoredColumns: string[];
  /** Set when a byte-identical file was imported before. */
  sameFileImportedAt: string | null;
};

export type ImportRow = {
  id: number;
  file_name: string;
  file_size: number;
  created_at: string;
  rows_read: number;
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  ignored_columns: string;
  problems: string;
  file_sha256: string;
};

export function toSummary(row: ImportRow, sameFileImportedAt: string | null): ImportSummary {
  return {
    id: row.id,
    fileName: row.file_name,
    fileSize: row.file_size,
    createdAt: row.created_at,
    rowsRead: row.rows_read,
    imported: row.created + row.updated + row.unchanged,
    created: row.created,
    updated: row.updated,
    unchanged: row.unchanged,
    rejected: row.rejected,
    problemCount: (JSON.parse(row.problems) as unknown[]).length,
    ignoredColumns: JSON.parse(row.ignored_columns),
    sameFileImportedAt,
  };
}

export function sameStudent(existing: Record<string, unknown>, s: StudentRecord): boolean {
  return (
    existing.full_name === s.fullName &&
    existing.email === s.email &&
    existing.date_of_birth === s.dateOfBirth &&
    existing.grade_level === s.gradeLevel &&
    existing.section === s.section &&
    SUBJECT_COLS.every((c) => existing[c] === s.marks[c])
  );
}

/**
 * Store an analysed file. Students are upserted by student ID: a later upload
 * replaces that student's details, and re-uploading the same file changes nothing.
 * One transaction, so a crash mid-import leaves the previous data intact.
 */
export function applyImport(
  db: Db,
  analysis: Analysis,
  file: { name: string; bytes: Uint8Array },
  now = new Date(),
): ImportSummary {
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const createdAt = now.toISOString();
  const previous = db
    .prepare("SELECT created_at FROM imports WHERE file_sha256 = ? ORDER BY id LIMIT 1")
    .get(sha256) as { created_at: string } | undefined;

  const select = db.prepare(`SELECT * FROM students WHERE student_id = ?`);
  const cols = ["student_id", "full_name", "name_search", "email", "date_of_birth", "grade_level", "section", ...SUBJECT_COLS, "import_id", "updated_at"];
  const upsert = db.prepare(
    `INSERT INTO students (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})
     ON CONFLICT (student_id) DO UPDATE SET ${cols.slice(1).map((c) => `${c} = excluded.${c}`).join(", ")}`,
  );

  db.exec("BEGIN");
  try {
    const insertImport = db.prepare(
      `INSERT INTO imports (file_name, file_size, file_sha256, created_at, rows_read, created, updated, unchanged, rejected, ignored_columns, problems)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`,
    );
    const importId = Number(
      insertImport.run(
        file.name,
        file.bytes.length,
        sha256,
        createdAt,
        analysis.rowsRead,
        analysis.rejectedRows,
        JSON.stringify(analysis.ignoredColumns),
        JSON.stringify(analysis.problems),
      ).lastInsertRowid,
    );

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const { student: s } of analysis.accepted) {
      const existing = select.get(s.studentId) as Record<string, unknown> | undefined;
      if (existing && sameStudent(existing, s)) {
        unchanged++;
        continue;
      }
      if (existing) updated++;
      else created++;
      upsert.run(
        s.studentId,
        s.fullName,
        searchKey(s.fullName),
        s.email,
        s.dateOfBirth,
        s.gradeLevel,
        s.section,
        ...SUBJECT_COLS.map((c) => s.marks[c]),
        importId,
        createdAt,
      );
    }
    db.prepare("UPDATE imports SET created = ?, updated = ?, unchanged = ? WHERE id = ?").run(
      created,
      updated,
      unchanged,
      importId,
    );
    db.exec("COMMIT");
    return getImport(db, importId, previous?.created_at ?? null)!;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getImport(db: Db, id: number, sameFileImportedAt: string | null = null): ImportSummary | null {
  const row = db.prepare("SELECT * FROM imports WHERE id = ?").get(id) as ImportRow | undefined;
  return row ? toSummary(row, sameFileImportedAt) : null;
}

export function getImportProblems(db: Db, id: number): RowProblem[] | null {
  const row = db.prepare("SELECT problems FROM imports WHERE id = ?").get(id) as { problems: string } | undefined;
  return row ? JSON.parse(row.problems) : null;
}

export function listImports(db: Db, limit = 10): ImportSummary[] {
  const rows = db.prepare("SELECT * FROM imports ORDER BY id DESC LIMIT ?").all(limit) as ImportRow[];
  return rows.map((r) => toSummary(r, null));
}

export type StudentDetail = Omit<StudentRecord, "marks"> & { marks: Marks; result: Result; updatedAt: string };
export type StudentListItem = {
  studentId: string;
  fullName: string;
  gradeLevel: number;
  section: string;
  percentage: number;
  grade: Result["grade"];
  passed: boolean;
};

export function rowToDetail(r: Record<string, unknown>): StudentDetail {
  const marks = Object.fromEntries(SUBJECT_COLS.map((c) => [c, r[c] as number])) as Marks;
  return {
    studentId: r.student_id as string,
    fullName: r.full_name as string,
    email: r.email as string,
    dateOfBirth: r.date_of_birth as string,
    gradeLevel: r.grade_level as number,
    section: r.section as string,
    marks,
    result: computeResult(marks),
    updatedAt: r.updated_at as string,
  };
}

export function getStudent(db: Db, id: string): StudentDetail | null {
  const r = db.prepare("SELECT * FROM students WHERE student_id = ?").get(id.trim().toUpperCase());
  return r ? rowToDetail(r as Record<string, unknown>) : null;
}

const SORTS = {
  id: "student_id",
  name: "name_search",
  class: "grade_level, section",
  percentage: "total",
} as const;
export type SortKey = keyof typeof SORTS;
export const isSortKey = (s: string): s is SortKey => Object.hasOwn(SORTS, s);

export type ListQuery = {
  q?: string;
  gradeLevel?: number;
  section?: string;
  sort?: SortKey;
  desc?: boolean;
  page: number;
  pageSize: number;
};

export function studentListSql(query: ListQuery) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const q = query.q?.trim();
  if (q) {
    const like = `%${searchKey(q).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(`(name_search LIKE ? ESCAPE '\\' OR lower(student_id) LIKE ? ESCAPE '\\')`);
    params.push(like, like);
  }
  if (query.gradeLevel !== undefined) {
    where.push("grade_level = ?");
    params.push(query.gradeLevel);
  }
  if (query.section) {
    where.push("section = ?");
    params.push(query.section);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const dir = query.desc ? "DESC" : "ASC";
  const order = SORTS[query.sort ?? "id"]
    .split(", ")
    .map((c) => `${c} ${dir}`)
    .join(", ");
  return {
    count: `SELECT count(*) AS n FROM students ${whereSql}`,
    page: `SELECT * FROM students ${whereSql} ORDER BY ${order}, student_id LIMIT ? OFFSET ?`,
    params,
    pagination: [query.pageSize, (query.page - 1) * query.pageSize],
  };
}

export function rowToListItem(row: Record<string, unknown>): StudentListItem {
  const { studentId, fullName, gradeLevel, section, result } = rowToDetail(row);
  return { studentId, fullName, gradeLevel, section, percentage: result.percentage, grade: result.grade, passed: result.passed };
}

export function listStudents(db: Db, query: ListQuery): StudentPage {
  const sql = studentListSql(query);
  const { n } = db.prepare(sql.count).get(...sql.params) as { n: number };
  const rows = db.prepare(sql.page).all(...sql.params, ...sql.pagination);
  return { total: n, items: rows.map(rowToListItem) };
}

type StudentPage = { items: StudentListItem[]; total: number };
type ResultOf<T> = T | Promise<T>;
export type ImportFile = { name: string; bytes: Uint8Array };

export type ResultsStore = {
  applyImport(analysis: Analysis, file: ImportFile): ResultOf<ImportSummary>;
  getImport(id: number): ResultOf<ImportSummary | null>;
  getImportProblems(id: number): ResultOf<RowProblem[] | null>;
  listImports(): ResultOf<ImportSummary[]>;
  listStudents(query: ListQuery): ResultOf<StudentPage>;
  getStudent(id: string): ResultOf<StudentDetail | null>;
};

export function sqliteStore(db: Db): ResultsStore {
  return {
    applyImport: (analysis, file) => applyImport(db, analysis, file),
    getImport: (id) => getImport(db, id),
    getImportProblems: (id) => getImportProblems(db, id),
    listImports: () => listImports(db),
    listStudents: (query) => listStudents(db, query),
    getStudent: (id) => getStudent(db, id),
  };
}
