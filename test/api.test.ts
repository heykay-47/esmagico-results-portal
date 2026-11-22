// End-to-end through HTTP: upload, re-upload, browse, report, bad input.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { openDb } from "../src/db.ts";
import { createApp, MAX_UPLOAD_BYTES } from "../src/server.ts";

const HEADER = "student_id,full_name,email,date_of_birth,grade_level,section,maths,science,english,social_studies,second_language";
const FILE = [
  HEADER,
  "STU001,Aarav Sharma,aarav@example.edu,2012-03-14,9,B,82,74,79,71,86",
  "STU002,José Pereira,jose@example.edu,2013-01-02,8,A,30,90,90,90,90",
  "STU003,Bad Mark,bad@example.edu,2013-01-02,8,A,101,90,90,90,90",
  "STU004,Søren Iyer,soren@example.edu,2013-01-02,8,C,50,50,50,50,50",
  "STU001,Duplicate Row,dup@example.edu,2012-03-14,9,B,1,1,1,1,1",
].join("\r\n");

let server: Server;
let base: string;

before(async () => {
  const app = createApp(openDb(":memory:"), { today: () => ({ year: 2026, month: 11, day: 18 }) });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(() => server.close());

const upload = (body: string | Uint8Array<ArrayBuffer>, name = "results.csv") =>
  fetch(`${base}/imports`, { method: "POST", body, headers: { "x-file-name": encodeURIComponent(name) } });
const getJson = async (path: string) => (await fetch(`${base}${path}`)).json();

test("upload reports what was accepted and rejected, then re-upload changes nothing", async () => {
  const first = await (await upload(FILE)).json();
  assert.deepEqual(
    [first.rowsRead, first.imported, first.created, first.rejected, first.problemCount, first.sameFileImportedAt],
    [5, 3, 3, 2, 2, null],
  );
  assert.deepEqual(first.problems.map((p: { line: number; code: string }) => [p.line, p.code]), [
    [4, "OUT_OF_RANGE"],
    [6, "DUPLICATE_ID"],
  ]);

  const again = await (await upload(FILE)).json();
  assert.deepEqual([again.created, again.updated, again.unchanged], [0, 0, 3]);
  assert.equal(again.sameFileImportedAt, first.createdAt);
  assert.equal((await getJson("/students")).total, 3);
});

test("a later file updates an existing student instead of duplicating them", async () => {
  const res = await (await upload([HEADER, "stu001,Aarav Sharma,aarav@example.edu,2012-03-14,9,B,90,74,79,71,86"].join("\n"))).json();
  assert.deepEqual([res.created, res.updated], [0, 1]);
  const report = await getJson("/students/STU001");
  assert.equal(report.marks.maths, 90);
  assert.equal(report.result.total, 400);
});

test("student report includes the computed result; unknown IDs are a 404", async () => {
  const report = await getJson("/students/stu002");
  assert.equal(report.fullName, "José Pereira");
  assert.deepEqual([report.result.percentage, report.result.grade, report.result.passed], [78, "B", false]);
  assert.equal((await fetch(`${base}/students/NOPE`)).status, 404);
});

test("search is case- and accent-insensitive, matches IDs, and paginates", async () => {
  const byName = await getJson("/students?q=JOSE");
  assert.deepEqual(byName.items.map((s: { studentId: string }) => s.studentId), ["STU002"]);
  const folded = await getJson("/students?q=soren");
  assert.deepEqual(folded.items.map((s: { fullName: string }) => s.fullName), ["Søren Iyer"]);
  const byId = await getJson("/students?q=stu00");
  assert.equal(byId.total, 3);
  const page2 = await getJson("/students?pageSize=10&page=2");
  assert.deepEqual([page2.total, page2.items.length], [3, 0]);
  const wildcard = await getJson("/students?q=%25");
  assert.equal(wildcard.total, 0, "a literal % must not match everything");
});

test("problem report downloads as CSV with every problem", async () => {
  const imports = await getJson("/imports");
  const firstId = imports.items.at(-1).id;
  const csv = await (await fetch(`${base}/imports/${firstId}/problems.csv`)).text();
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[2], /^6,STU001,student_id,DUPLICATE_ID,/);
});

test("bad files get a clear error and the app keeps serving", async () => {
  const notCsv = await upload(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "results.xlsx");
  assert.equal(notCsv.status, 422);
  assert.match((await notCsv.json()).error, /Excel/);

  const tooBig = await upload(new Uint8Array(MAX_UPLOAD_BYTES + 1));
  assert.equal(tooBig.status, 413);

  const missing = await upload("name,marks\nA,1\n");
  assert.equal(missing.status, 422);
  assert.match((await missing.json()).error, /missing these columns/);

  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await getJson("/students")).total, 3, "failed uploads must not change data");
});

test("hosted uploads require the configured password; browsing stays public", async () => {
  const db = openDb(":memory:");
  const password = "test password % ✓";
  const demo = createApp(db, {
    today: () => ({ year: 2026, month: 11, day: 18 }),
    requireImportPassword: true,
    importPassword: password,
    uploadLimit: 1024,
  }).listen(0);
  try {
    await new Promise((resolve) => demo.once("listening", resolve));
    const url = `http://127.0.0.1:${(demo.address() as AddressInfo).port}/api`;
    const request = (headers: Record<string, string>) => fetch(`${url}/imports`, { method: "POST", body: FILE, headers });
    assert.deepEqual(await (await fetch(`${url}/import-settings`)).json(), {
      maxBytes: 1024, passwordRequired: true, enabled: true,
    });
    assert.equal((await request({})).status, 403);
    assert.equal((await request({ "x-demo-password": "%" })).status, 403);
    assert.equal((await (await fetch(`${url}/students`)).json()).total, 0);
    assert.equal((await request({ "x-demo-password": encodeURIComponent(password) })).status, 201);
    assert.equal((await (await fetch(`${url}/students`)).json()).total, 3);
  } finally {
    await new Promise<void>((resolve) => demo.close(() => resolve()));
    db.close();
  }
});
