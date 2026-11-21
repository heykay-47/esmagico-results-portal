// Grading scheme (stated in NOTES.md and shown on every report):
//   Percentage = total / 500, shown to one decimal place.
//   Grade by percentage: A >= 80, B >= 60, C >= 50, D >= 33, F below 33.
//   Pass = at least 33 in every subject (and therefore at least 33% overall).
// 33 is the pass mark Indian school boards use, which fits the sample data.

import { SUBJECTS, type Marks, type SubjectKey } from "./rules.ts";

export const PASS_MARK = 33;
export const MAX_PER_SUBJECT = 100;
export const MAX_TOTAL = MAX_PER_SUBJECT * SUBJECTS.length;

export const GRADE_BANDS = [
  { grade: "A", min: 80 },
  { grade: "B", min: 60 },
  { grade: "C", min: 50 },
  { grade: "D", min: 33 },
  { grade: "F", min: 0 },
] as const;

export type Grade = (typeof GRADE_BANDS)[number]["grade"];

export type Result = {
  total: number;
  maxTotal: number;
  percentage: number;
  grade: Grade;
  passed: boolean;
  failedSubjects: SubjectKey[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function gradeFor(percentage: number): Grade {
  return GRADE_BANDS.find((b) => percentage >= b.min)!.grade;
}

export function computeResult(marks: Marks): Result {
  // Marks may have decimals; round the sum to avoid 0.1 + 0.2 noise.
  const total = Math.round(SUBJECTS.reduce((sum, s) => sum + marks[s.key], 0) * 100) / 100;
  const percentage = round1((total / MAX_TOTAL) * 100);
  const failedSubjects = SUBJECTS.filter((s) => marks[s.key] < PASS_MARK).map((s) => s.key);
  return {
    total,
    maxTotal: MAX_TOTAL,
    percentage,
    // Grade the rounded figure so the letter always agrees with the number shown.
    grade: gradeFor(percentage),
    passed: failedSubjects.length === 0,
    failedSubjects,
  };
}
