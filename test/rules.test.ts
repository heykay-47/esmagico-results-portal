import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRow, type ErrorCode } from "../src/rules.ts";

const TODAY = { year: 2026, month: 11, day: 18 };

const VALID: Record<string, string> = {
  student_id: "STU00001",
  full_name: "Aarav Sharma",
  email: "aarav@example.edu",
  date_of_birth: "2012-03-14",
  grade_level: "9",
  section: "B",
  maths: "82",
  science: "74",
  english: "79",
  social_studies: "71",
  second_language: "86",
};

function codesFor(field: string, value: string): ErrorCode[] {
  const result = validateRow({ ...VALID, [field]: value }, TODAY);
  return result.ok ? [] : result.problems.map((p) => p.code);
}

test("a clean row is accepted and normalised", () => {
  const result = validateRow(
    {
      ...VALID,
      student_id: " stu-0001 ",
      full_name: "  Singh,   Aarav ",
      email: " AARAV@Example.EDU ",
      date_of_birth: "14/03/2012",
      grade_level: "09",
      section: "b",
      maths: "82.5",
    },
    TODAY,
  );
  assert.ok(result.ok);
  assert.deepEqual(
    {
      id: result.student.studentId,
      name: result.student.fullName,
      email: result.student.email,
      dob: result.student.dateOfBirth,
      grade: result.student.gradeLevel,
      section: result.student.section,
      maths: result.student.marks.maths,
    },
    { id: "STU-0001", name: "Singh, Aarav", email: "aarav@example.edu", dob: "2012-03-14", grade: 9, section: "B", maths: 82.5 },
  );
});

const cases: [field: string, value: string, expected: ErrorCode[]][] = [
  // Blank or whitespace-only is missing, not a format error.
  ["full_name", "   ", ["MISSING_REQUIRED"]],
  ["maths", "", ["MISSING_REQUIRED"]],
  ["student_id", "ab", ["INVALID_FORMAT"]],
  ["student_id", "STU 001", ["INVALID_FORMAT"]],
  ["student_id", "A".repeat(21), ["INVALID_FORMAT"]],
  ["full_name", "A", ["OUT_OF_RANGE"]],
  ["full_name", "R2-D2", ["INVALID_FORMAT"]],
  ["email", "sana@example", ["INVALID_FORMAT"]],
  ["email", "riya@@example.edu", ["INVALID_FORMAT"]],
  ["email", "kabir at example.edu", ["INVALID_FORMAT"]],
  ["email", "@example.edu", ["INVALID_FORMAT"]],
  ["date_of_birth", "11-30-2010", ["INVALID_FORMAT"]],
  ["date_of_birth", "14.03.2011", ["INVALID_FORMAT"]],
  ["date_of_birth", "tomorrow", ["INVALID_FORMAT"]],
  ["date_of_birth", "2011-02-29", ["INVALID_FORMAT"]],
  ["date_of_birth", "31/04/2012", ["INVALID_FORMAT"]],
  ["date_of_birth", "1970-01-01", ["OUT_OF_RANGE"]],
  ["date_of_birth", "2031-05-01", ["OUT_OF_RANGE"]],
  ["grade_level", "IX", ["INVALID_FORMAT"]],
  ["grade_level", "9th", ["INVALID_FORMAT"]],
  ["grade_level", "9.5", ["INVALID_FORMAT"]],
  ["grade_level", "0", ["OUT_OF_RANGE"]],
  ["grade_level", "13", ["OUT_OF_RANGE"]],
  ["grade_level", "-2", ["OUT_OF_RANGE"]],
  ["section", "Z", ["OUT_OF_RANGE"]],
  ["section", "AB", ["INVALID_FORMAT"]],
  ["section", "1", ["INVALID_FORMAT"]],
  ["maths", "-5", ["OUT_OF_RANGE"]],
  ["maths", "100.5", ["OUT_OF_RANGE"]],
  // Number() would turn these into 1000, 16 and Infinity; they are not plain marks.
  ["maths", "1e3", ["INVALID_FORMAT"]],
  ["maths", "0x10", ["INVALID_FORMAT"]],
  ["maths", "Infinity", ["INVALID_FORMAT"]],
  ["maths", "N/A", ["INVALID_FORMAT"]],
  ["maths", "82/100", ["INVALID_FORMAT"]],
];

for (const [field, value, expected] of cases) {
  test(`${field} = ${JSON.stringify(value)} → ${expected.join(", ")}`, () => {
    assert.deepEqual(codesFor(field, value), expected);
  });
}

test("boundary values are accepted", () => {
  for (const [field, value] of [
    ["maths", "0"],
    ["maths", "100"],
    ["maths", "100.0"],
    ["grade_level", "1"],
    ["grade_level", "12"],
    ["section", "F"],
    ["student_id", "ABC"],
    ["full_name", "Zoë D'Souza"],
    ["full_name", "Ritu Kumārī"],
    ["full_name", "Søren Iyer"],
    ["date_of_birth", "2012-02-29"],
  ]) {
    assert.deepEqual(codesFor(field, value), [], `${field}=${value}`);
  }
});

test("age must be 5 to 25 in completed years on the import date", () => {
  // Today is 2026-11-18.
  assert.deepEqual(codesFor("date_of_birth", "2021-11-18"), [], "turns 5 today");
  assert.deepEqual(codesFor("date_of_birth", "2021-11-19"), ["OUT_OF_RANGE"], "still 4");
  assert.deepEqual(codesFor("date_of_birth", "2000-11-19"), [], "25, turns 26 tomorrow");
  assert.deepEqual(codesFor("date_of_birth", "2000-11-18"), ["OUT_OF_RANGE"], "turns 26 today");
});

test("every problem in a row is reported, not just the first", () => {
  const result = validateRow({ ...VALID, email: "nope", section: "Z", maths: "" }, TODAY);
  assert.ok(!result.ok);
  assert.deepEqual(
    result.problems.map((p) => [p.field, p.code]),
    [
      ["email", "INVALID_FORMAT"],
      ["section", "OUT_OF_RANGE"],
      ["maths", "MISSING_REQUIRED"],
    ],
  );
});
