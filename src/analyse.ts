// Turn an uploaded file into accepted students and a problem list.
// Pure: bytes in, plan out. Persisting the plan is db.ts's job.

import { parseCsv } from "./csv.ts";
import {
  COLUMNS,
  REQUIRED_COLUMNS,
  normaliseId,
  validateRow,
  type CalendarDate,
  type ErrorCode,
  type StudentRecord,
} from "./rules.ts";

export type RowProblem = {
  /** Line number in the file; header is line 1, blank lines counted. */
  line: number;
  /** Student ID as written in the file (trimmed), "" if blank. */
  studentId: string;
  /** Column key, or "(whole row)". */
  field: string;
  code: ErrorCode;
  message: string;
};

export type Analysis = {
  rowsRead: number;
  accepted: { line: number; student: StudentRecord }[];
  rejectedRows: number;
  problems: RowProblem[];
  /** Header columns we did not use, e.g. parent_phone. Shown as information. */
  ignoredColumns: string[];
};

export type FileErrorCode = "EMPTY_FILE" | "NOT_TEXT" | "NOT_CSV" | "MISSING_COLUMNS" | "DUPLICATE_COLUMNS";

/** The whole file cannot be imported. The message is shown to the administrator as-is. */
export class FileError extends Error {
  readonly code: FileErrorCode;
  constructor(code: FileErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const WHOLE_ROW = "(whole row)";

function decode(bytes: Uint8Array): string {
  if (bytes.length === 0) throw new FileError("EMPTY_FILE", "The file is empty.");
  // Zip signature: .xlsx/.ods files are zip archives.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    throw new FileError(
      "NOT_CSV",
      "This looks like an Excel or other spreadsheet file, not a CSV. In your spreadsheet app choose File → Save As → CSV UTF-8, then upload that file.",
    );
  }
  let text: string;
  try {
    // TextDecoder strips a UTF-8 byte order mark by default.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new FileError(
      "NOT_TEXT",
      "The file is not UTF-8 text. Save it from your spreadsheet app as \"CSV UTF-8\" and upload it again.",
    );
  }
  if (text.includes("\u0000")) {
    throw new FileError("NOT_TEXT", "The file contains binary data and does not look like a CSV.");
  }
  return text;
}

const isBlank = (fields: string[]) => fields.every((f) => f.trim() === "");

export function analyse(bytes: Uint8Array, today: CalendarDate): Analysis {
  const text = decode(bytes);
  const { records, unclosedQuoteLine } = parseCsv(text);
  const content = records.filter((r) => !isBlank(r.fields));
  if (content.length === 0) throw new FileError("EMPTY_FILE", "The file has no header row and no data.");

  const [header, ...rows] = content;
  const headerKeys = header.fields.map((h) => h.trim().toLowerCase());

  const missing = REQUIRED_COLUMNS.filter((c) => !headerKeys.includes(c));
  if (missing.length > 0) {
    const looksLikeData = header.fields.some((f) => /@|\d{4}-\d{2}-\d{2}/.test(f));
    throw new FileError(
      "MISSING_COLUMNS",
      `The header row is missing these columns: ${missing.join(", ")}.` +
        (looksLikeData ? " The first row looks like student data; the file may have no header row." : ""),
    );
  }
  const repeated = REQUIRED_COLUMNS.filter((c) => headerKeys.indexOf(c) !== headerKeys.lastIndexOf(c));
  if (repeated.length > 0) {
    throw new FileError(
      "DUPLICATE_COLUMNS",
      `These columns appear more than once in the header, so we cannot tell which to use: ${repeated.join(", ")}.`,
    );
  }

  const ignoredColumns = header.fields
    .map((h) => h.trim())
    .filter((h, i) => h !== "" && !REQUIRED_COLUMNS.includes(headerKeys[i]));
  const indexOf = Object.fromEntries(COLUMNS.map((c) => [c.key, headerKeys.indexOf(c.key)]));
  const expected = header.fields.length;

  const accepted: Analysis["accepted"] = [];
  const problems: RowProblem[] = [];
  // First line each normalised ID appeared on; the first row is the original
  // even if that row is itself rejected.
  const firstSeen = new Map<string, number>();
  let rejectedRows = 0;

  for (const [index, record] of rows.entries()) {
    const { line, fields } = record;
    const rawId = (fields[indexOf.student_id] ?? "").trim();
    const isLast = index === rows.length - 1;

    if (unclosedQuoteLine !== null && isLast && line <= unclosedQuoteLine) {
      rejectedRows++;
      problems.push({
        line,
        studentId: rawId,
        field: WHOLE_ROW,
        code: "INVALID_FORMAT",
        message: `A quote (") opened on line ${unclosedQuoteLine} is never closed, so this row and everything after it could not be read`,
      });
      continue;
    }

    if (fields.length !== expected) {
      rejectedRows++;
      problems.push({
        line,
        studentId: rawId,
        field: WHOLE_ROW,
        code: "WRONG_FIELD_COUNT",
        message: `Expected ${expected} values, found ${fields.length}. A comma is probably missing or extra, so the values cannot be matched to columns`,
      });
      continue;
    }

    const row = Object.fromEntries(COLUMNS.map((c) => [c.key, fields[indexOf[c.key]]]));
    const result = validateRow(row, today);
    const rowProblems: RowProblem[] = result.ok
      ? []
      : result.problems.map((p) => ({ line, studentId: rawId, ...p }));

    const id = normaliseId(rawId);
    if (id !== null) {
      const first = firstSeen.get(id);
      if (first === undefined) firstSeen.set(id, line);
      else {
        rowProblems.unshift({
          line,
          studentId: rawId,
          field: "student_id",
          code: "DUPLICATE_ID",
          message: `${id} already appears on line ${first}; only the first row for a student is used`,
        });
      }
    }

    if (rowProblems.length > 0) {
      rejectedRows++;
      problems.push(...rowProblems);
    } else if (result.ok) {
      accepted.push({ line, student: result.student });
    }
  }

  return { rowsRead: rows.length, accepted, rejectedRows, problems, ignoredColumns };
}
