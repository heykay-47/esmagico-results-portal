import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { analyse, FileError } from "../src/analyse.ts";

const TODAY = { year: 2026, month: 11, day: 18 };
const HEADER = "student_id,full_name,email,date_of_birth,grade_level,section,maths,science,english,social_studies,second_language";
const row = (id: string, overrides = "") =>
  overrides || `${id},Aarav Sharma,${id.toLowerCase()}@example.edu,2012-03-14,9,B,82,74,79,71,86`;

const run = (text: string | Uint8Array) =>
  analyse(typeof text === "string" ? new TextEncoder().encode(text) : text, TODAY);

const fileErrorCode = (text: string | Uint8Array) => {
  try {
    run(text);
  } catch (err) {
    if (err instanceof FileError) return err.code;
    throw err;
  }
  return null;
};

test("header: any order, any case, surrounding spaces, extra columns ignored, BOM stripped", () => {
  const header = "﻿ Section ,MATHS,science,english,social_studies,second_language,parent_phone,student_id,full_name,email,date_of_birth,grade_level";
  const a = run(`${header}\r\nb,82,74,79,71,86,+91 99,stu1,Aarav Sharma,a@example.edu,2012-03-14,9\r\n`);
  assert.equal(a.accepted.length, 1);
  assert.equal(a.accepted[0].student.studentId, "STU1");
  assert.equal(a.accepted[0].student.section, "B");
  assert.deepEqual(a.ignoredColumns, ["parent_phone"]);
});

test("blank lines and all-empty rows are skipped and not counted, but line numbers still count them", () => {
  const a = run([HEADER, "", row("STU001"), "   ", ",,,,,,,,,,", ",,,,", row("STU002", "STU002,,x@example.edu,2012-03-14,9,B,1,1,1,1,1"), ""].join("\n"));
  assert.equal(a.rowsRead, 2);
  assert.equal(a.accepted.length, 1);
  assert.deepEqual(a.problems.map((p) => [p.line, p.field, p.code]), [[7, "full_name", "MISSING_REQUIRED"]]);
});

test("a row with the wrong number of fields is rejected as a whole with one problem", () => {
  const a = run([HEADER, "STU001,Aarav,a@example.edu,2012-03-14,9,B,82,74,79,71", `${row("STU002")},extra`].join("\n"));
  assert.equal(a.rejectedRows, 2);
  assert.deepEqual(a.problems.map((p) => [p.line, p.field, p.code]), [
    [2, "(whole row)", "WRONG_FIELD_COUNT"],
    [3, "(whole row)", "WRONG_FIELD_COUNT"],
  ]);
});

test("duplicates: first row with an ID wins, even if that first row is itself invalid; case-insensitive", () => {
  const a = run(
    [
      HEADER,
      "STU001,Aarav Sharma,a@example.edu,2012-03-14,9,B,-5,74,79,71,86", // invalid original
      row("stu001"), // valid, but a duplicate of line 2
      row("STU002"),
      row(" Stu002 "),
    ].join("\n"),
  );
  assert.deepEqual(a.accepted.map((r) => r.student.studentId), ["STU002"]);
  assert.equal(a.rejectedRows, 3);
  const duplicates = a.problems.filter((p) => p.code === "DUPLICATE_ID");
  assert.deepEqual(duplicates.map((p) => p.line), [3, 5]);
  assert.match(duplicates[0].message, /STU001 already appears on line 2/);
  assert.match(duplicates[1].message, /STU002 already appears on line 4/);
});

test("a quoted name with a comma is one field, not a wrong field count", () => {
  const a = run([HEADER, 'STU001,"Patel, Sahil",s@example.edu,2011-02-28,10,A,86,79,95.6,69.0,78'].join("\r\n"));
  assert.equal(a.accepted[0].student.fullName, "Patel, Sahil");
});

test("an unclosed quote rejects the swallowed row and says why", () => {
  const a = run([HEADER, row("STU001"), 'STU002,"Broken,b@example.edu,2012-03-14,9,B,1,1,1,1,1', row("STU003")].join("\n"));
  assert.equal(a.accepted.length, 1);
  assert.equal(a.problems.at(-1)!.line, 3);
  assert.match(a.problems.at(-1)!.message, /never closed/);
});

test("bad files are refused with a file-level reason instead of a pile of row errors", () => {
  assert.equal(fileErrorCode(""), "EMPTY_FILE");
  assert.equal(fileErrorCode("\n\n  \n"), "EMPTY_FILE");
  assert.equal(fileErrorCode("student_id,full_name\nSTU1,A B\n"), "MISSING_COLUMNS");
  assert.equal(fileErrorCode(row("STU001")), "MISSING_COLUMNS"); // no header row
  assert.equal(fileErrorCode(`${HEADER},email\n`), "DUPLICATE_COLUMNS");
  assert.equal(fileErrorCode(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14])), "NOT_CSV"); // .xlsx
  assert.equal(fileErrorCode(new Uint8Array([0x73, 0x74, 0xe9, 0x0a])), "NOT_TEXT"); // Latin-1 "sté"
});

test("header-only file is valid and imports nothing", () => {
  const a = run(`${HEADER}\n`);
  assert.deepEqual([a.rowsRead, a.accepted.length, a.rejectedRows], [0, 0, 0]);
});

// The sample pack from the brief is confidential and not committed. When it is
// present in the repo root, check the counts its README says we must report.
for (const [file, read, imported, rejected] of [
  ["students_small.csv", 25, 16, 9],
  ["students_sample.csv", 5000, 4685, 315],
] as const) {
  const path = new URL(`../${file}`, import.meta.url);
  test(`sample pack: ${file} → ${read} read, ${imported} imported, ${rejected} rejected`, { skip: !existsSync(path) && "sample pack not present" }, () => {
    const a = analyse(readFileSync(path), TODAY);
    assert.deepEqual([a.rowsRead, a.accepted.length, a.rejectedRows], [read, imported, rejected]);
  });
}
