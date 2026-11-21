// Column rules: turn one CSV row (raw strings) into a typed StudentRecord, or a
// list of problems written for a school administrator. Pure, no I/O.

export const SUBJECTS = [
  { key: "maths", label: "Maths" },
  { key: "science", label: "Science" },
  { key: "english", label: "English" },
  { key: "social_studies", label: "Social studies" },
  { key: "second_language", label: "Second language" },
] as const;

export type SubjectKey = (typeof SUBJECTS)[number]["key"];
export type Marks = Record<SubjectKey, number>;

export type StudentRecord = {
  studentId: string;
  fullName: string;
  email: string;
  /** ISO date, YYYY-MM-DD */
  dateOfBirth: string;
  gradeLevel: number;
  section: string;
  marks: Marks;
};

export type ErrorCode =
  | "MISSING_REQUIRED"
  | "INVALID_FORMAT"
  | "OUT_OF_RANGE"
  | "DUPLICATE_ID"
  | "WRONG_FIELD_COUNT";

export type FieldProblem = { field: string; code: ErrorCode; message: string };

type Parsed<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; message: string };
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = (code: ErrorCode, message: string): Parsed<never> => ({ ok: false, code, message });

/** Calendar date as numbers, so "today" can be injected in tests. */
export type CalendarDate = { year: number; month: number; day: number };

export function todayUtc(now = new Date()): CalendarDate {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
}

const ID_RE = /^[A-Za-z0-9-]{3,20}$/;
// Letters from any script plus combining marks, apostrophes (straight or curly),
// commas ("Singh, Aarav"), hyphens, full stops and spaces.
const NAME_RE = /^[\p{L}\p{M}'’,.\- ]+$/u;
const EMAIL_RE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const INTEGER_RE = /^[+-]?\d+$/;
// Plain decimals only: rejects "", "1e3", "0x10", "Infinity" that Number() would accept.
const DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

function parseStudentId(v: string): Parsed<string> {
  if (!ID_RE.test(v)) {
    return fail("INVALID_FORMAT", `"${v}" is not a valid student ID (3 to 20 letters, digits or hyphens)`);
  }
  return ok(v.toUpperCase());
}

function parseFullName(v: string): Parsed<string> {
  const name = v.replace(/\s+/g, " ");
  const length = [...name].length;
  if (length < 2 || length > 100) {
    return fail("OUT_OF_RANGE", `Name must be 2 to 100 characters long (found ${length})`);
  }
  if (!NAME_RE.test(name) || !/\p{L}/u.test(name)) {
    return fail("INVALID_FORMAT", `"${name}" contains characters that are not allowed in a name`);
  }
  return ok(name);
}

function parseEmail(v: string): Parsed<string> {
  const email = v.toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return fail("INVALID_FORMAT", `"${v}" is not a valid email address`);
  }
  return ok(email);
}

function completedYears(dob: CalendarDate, today: CalendarDate): number {
  const hadBirthday = today.month > dob.month || (today.month === dob.month && today.day >= dob.day);
  return today.year - dob.year - (hadBirthday ? 0 : 1);
}

const MIN_AGE = 5;
const MAX_AGE = 25;

function parseDateOfBirth(v: string, today: CalendarDate): Parsed<string> {
  let parts: CalendarDate | null = null;
  const iso = ISO_DATE_RE.exec(v);
  const dmy = DMY_DATE_RE.exec(v);
  if (iso) parts = { year: +iso[1], month: +iso[2], day: +iso[3] };
  else if (dmy) parts = { year: +dmy[3], month: +dmy[2], day: +dmy[1] };
  if (!parts) {
    return fail("INVALID_FORMAT", `"${v}" is not a date in the form YYYY-MM-DD or DD/MM/YYYY`);
  }
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const real =
    d.getUTCFullYear() === parts.year && d.getUTCMonth() === parts.month - 1 && d.getUTCDate() === parts.day;
  if (!real) return fail("INVALID_FORMAT", `"${v}" is not a real calendar date`);

  const age = completedYears(parts, today);
  if (age < 0) return fail("OUT_OF_RANGE", `Date of birth ${v} is in the future`);
  if (age < MIN_AGE || age > MAX_AGE) {
    return fail("OUT_OF_RANGE", `Date of birth ${v} makes the student ${age}; expected ${MIN_AGE} to ${MAX_AGE}`);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return ok(`${parts.year}-${pad(parts.month)}-${pad(parts.day)}`);
}

function parseGradeLevel(v: string): Parsed<number> {
  if (!INTEGER_RE.test(v)) return fail("INVALID_FORMAT", `"${v}" is not a whole number (use 1 to 12)`);
  const n = Number(v);
  if (n < 1 || n > 12) return fail("OUT_OF_RANGE", `Class ${v} is outside 1 to 12`);
  return ok(n);
}

function parseSection(v: string): Parsed<string> {
  if (!/^[A-Za-z]$/.test(v)) return fail("INVALID_FORMAT", `"${v}" is not a single letter`);
  const s = v.toUpperCase();
  if (s < "A" || s > "F") return fail("OUT_OF_RANGE", `Section ${s} is outside A to F`);
  return ok(s);
}

function parseMark(v: string): Parsed<number> {
  if (!DECIMAL_RE.test(v)) return fail("INVALID_FORMAT", `Mark "${v}" is not a number`);
  const n = Number(v);
  if (n < 0 || n > 100) return fail("OUT_OF_RANGE", `Mark ${v} is outside the allowed range 0 to 100`);
  return ok(n);
}

type Column = {
  key: string;
  label: string;
  parse: (value: string, today: CalendarDate) => Parsed<unknown>;
};

/** Every required column, in the order we report them. */
export const COLUMNS: readonly Column[] = [
  { key: "student_id", label: "Student ID", parse: parseStudentId },
  { key: "full_name", label: "Full name", parse: parseFullName },
  { key: "email", label: "Email", parse: parseEmail },
  { key: "date_of_birth", label: "Date of birth", parse: parseDateOfBirth },
  { key: "grade_level", label: "Class", parse: parseGradeLevel },
  { key: "section", label: "Section", parse: parseSection },
  ...SUBJECTS.map((s) => ({ key: s.key, label: s.label, parse: parseMark })),
];

export const REQUIRED_COLUMNS = COLUMNS.map((c) => c.key);

export type RowResult = { ok: true; student: StudentRecord } | { ok: false; problems: FieldProblem[] };

/** Validate one row. `row` maps column key to the raw cell text. */
export function validateRow(row: Record<string, string>, today: CalendarDate): RowResult {
  const values: Record<string, unknown> = {};
  const problems: FieldProblem[] = [];

  for (const col of COLUMNS) {
    const raw = (row[col.key] ?? "").trim();
    if (raw === "") {
      problems.push({ field: col.key, code: "MISSING_REQUIRED", message: `${col.label} is blank` });
      continue;
    }
    const result = col.parse(raw, today);
    if (result.ok) values[col.key] = result.value;
    else problems.push({ field: col.key, code: result.code, message: result.message });
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    student: {
      studentId: values.student_id as string,
      fullName: values.full_name as string,
      email: values.email as string,
      dateOfBirth: values.date_of_birth as string,
      gradeLevel: values.grade_level as number,
      section: values.section as string,
      marks: Object.fromEntries(SUBJECTS.map((s) => [s.key, values[s.key] as number])) as Marks,
    },
  };
}

/** Normalised student ID used for duplicate detection, or null if unusable. */
export function normaliseId(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  return ID_RE.test(v) ? v.toUpperCase() : null;
}
