import { test } from "node:test";
import assert from "node:assert/strict";
import { computeResult } from "../src/grading.ts";

const marks = (maths: number, science: number, english: number, social_studies: number, second_language: number) => ({
  maths,
  science,
  english,
  social_studies,
  second_language,
});

test("report from the brief's sketch: 392/500 = 78.4% → B, pass", () => {
  const r = computeResult(marks(82, 74, 79, 71, 86));
  assert.deepEqual([r.total, r.percentage, r.grade, r.passed], [392, 78.4, "B", true]);
});

test("grade bands: 80 → A, 60 → B, 50 → C, 33 → D, below → F", () => {
  assert.equal(computeResult(marks(80, 80, 80, 80, 80)).grade, "A");
  assert.equal(computeResult(marks(60, 60, 60, 60, 60)).grade, "B");
  assert.equal(computeResult(marks(50, 50, 50, 50, 50)).grade, "C");
  assert.equal(computeResult(marks(33, 33, 33, 33, 33)).grade, "D");
  assert.equal(computeResult(marks(32, 32, 32, 32, 32)).grade, "F");
});

test("grade follows the rounded percentage shown, so 79.96% displays as 80.0% and is an A", () => {
  const r = computeResult(marks(80, 80, 80, 80, 79.8));
  assert.deepEqual([r.percentage, r.grade], [80, "A"]);
});

test("one subject below 33 fails the student even with a good overall percentage", () => {
  const r = computeResult(marks(95, 95, 95, 95, 32.5));
  assert.equal(r.passed, false);
  assert.deepEqual(r.failedSubjects, ["second_language"]);
  assert.equal(r.grade, "A");
});

test("decimal marks add up without floating-point noise", () => {
  assert.equal(computeResult(marks(0.1, 0.2, 0, 0, 0)).total, 0.3);
});
