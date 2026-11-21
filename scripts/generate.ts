// Generate a realistic, messy results CSV. Every row is either clean-but-messy
// (padding, odd case, DD/MM dates, quoted "Last, First" names...) which must be
// accepted, or deliberately broken in one way which must be rejected. The
// generator counts the broken rows so callers can check the importer against it.

export type GenerateOptions = {
  rows: number;
  seed: number;
  /** Share of rows to break, 0 to 1. */
  errorRate: number;
  today: { year: number; month: number; day: number };
};

export type Generated = { csv: string; rowsRead: number; expectedRejected: number };

const FIRST = ["Aarav", "Diya", "Kabir", "Ananya", "Ishaan", "Meera", "Rohan", "Saanvi", "Vivaan", "Zoya", "Arjun", "Kavya", "Imran", "Tara", "Neha", "Farhan", "Zoë", "José", "Søren", "Amélie", "Noël"];
const LAST = ["Sharma", "Iyer", "Nair", "Khan", "Patel", "Reddy", "Das", "Bose", "Menon", "Gill", "Pereira", "D'Souza", "Kumārī", "Fernandes", "Chatterjee"];
const SUBJECTS = 5;

function rng(seed: number) {
  // mulberry32: small, fast, deterministic.
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Row = string[]; // student_id, full_name, email, dob, grade, section, 5 marks, parent_phone

export function generate(opts: GenerateOptions): Generated {
  const rand = rng(opts.seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const chance = (p: number) => rand() < p;
  const pad2 = (n: number) => String(n).padStart(2, "0");

  // Corruptions: each one makes the row invalid under the README rules.
  const corruptions: ((r: Row) => Row)[] = [
    (r) => set(r, 1, pick(["", "   "])),
    (r) => set(r, 2, pick(["not-an-email", "riya@@example.edu", "sana@example", "kabir at example.edu", "@example.edu", "diya@"])),
    (r) => set(r, 3, pick(["tomorrow", "31/02/2012", "11-30-2010", "14.03.2011", "2011-13-04", `${opts.today.year + 3}-05-01`, "1970-01-01"])),
    (r) => set(r, 4, pick(["IX", "ten", "9th", "0", "13", "-2", ""])),
    (r) => set(r, 5, pick(["Z", "G", "AB", "1", ""])),
    (r) => set(r, 6 + Math.floor(rand() * SUBJECTS), pick(["-5", "105", "100.5", "N/A", "eighty", "1e3", "82/100", "abc", ""])),
    (r) => set(r, 0, pick(["S1", "STU 0001", "STU_001", "X".repeat(21)])),
    (r) => r.slice(0, -2), // missing a value → wrong field count
    (r) => [...r, "extra"], // extra value → wrong field count
  ];
  const set = (r: Row, i: number, v: string) => r.map((x, j) => (j === i ? v : x));

  const lines: string[] = [];
  const header = "student_id,full_name,email,date_of_birth,grade_level,section,maths,science,english,social_studies,second_language,parent_phone";
  // IDs whose first row had the right number of fields; only these can be duplicated.
  const duplicable: string[] = [];
  let rowsRead = 0;
  let expectedRejected = 0;

  for (let i = 1; i <= opts.rows; i++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const grade = 1 + Math.floor(rand() * 12);
    // Age roughly matches the class (class 1 ≈ 6 years old), always within 5 to 25.
    const age = grade + 5 + (chance(0.3) ? 1 : 0);
    const year = opts.today.year - age - 1;
    const month = 1 + Math.floor(rand() * 12);
    const day = 1 + Math.floor(rand() * 28);
    const level = 35 + rand() * 55; // each student has an overall ability
    const marks = Array.from({ length: SUBJECTS }, () => {
      const m = Math.max(0, Math.min(100, level + (rand() - 0.5) * 30));
      return chance(0.3) ? m.toFixed(1) : String(Math.round(m));
    });
    const id = `STU${String(i).padStart(5, "0")}`;
    const email = `${first}.${last}${Math.floor(rand() * 100)}@example.edu`
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^A-Za-z0-9.@]/g, "")
      .toLowerCase();

    // Messy but valid presentation.
    let row: Row = [
      chance(0.02) ? id.toLowerCase() : id,
      chance(0.05) ? `"${last}, ${first}"` : `${first} ${last}`,
      chance(0.03) ? email.toUpperCase() : email,
      chance(0.25) ? `${pad2(day)}/${pad2(month)}/${year}` : `${year}-${pad2(month)}-${pad2(day)}`,
      chance(0.05) ? pad2(grade) : String(grade),
      chance(0.1) ? pick([..."abcdef"]) : pick([..."ABCDEF"]),
      ...marks,
      `+91 9${String(Math.floor(rand() * 1e9)).padStart(9, "0")}`,
    ];
    if (chance(0.02)) row = row.map((v, j) => (j === 1 || j === 2 || j === 5 || j === 6 ? `  ${v} ` : v));

    let broken = false;
    if (duplicable.length > 0 && chance(opts.errorRate * 0.2)) {
      row = set(row, 0, pick(duplicable));
      broken = true;
    } else if (chance(opts.errorRate)) {
      row = pick(corruptions)(row);
      broken = true;
    }
    if (row.length === 12 && /^STU\d{5}$/i.test(row[0])) duplicable.push(row[0].toUpperCase());

    lines.push(row.join(","));
    rowsRead++;
    if (broken) expectedRejected++;

    // Blank and all-empty lines are skipped by the importer and not counted.
    if (chance(0.002)) lines.push("");
    if (chance(0.001)) lines.push(",,,,,,,,,,,");
  }

  return { csv: "﻿" + [header, ...lines].join("\r\n") + "\r\n", rowsRead, expectedRejected };
}
