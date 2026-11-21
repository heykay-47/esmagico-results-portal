// Seed script: write a messy CSV and (optionally) import it into the database.
//
//   npm run seed                          # 5,000 rows → data/seed.csv
//   npm run seed -- --rows 20000 --load   # also import into DATABASE_PATH
//
// It always checks the importer's verdict against what it deliberately broke,
// and exits non-zero if they disagree.

import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generate } from "./generate.ts";
import { analyse } from "../src/analyse.ts";
import { applyImport, openDb } from "../src/db.ts";
import { todayUtc } from "../src/rules.ts";

const { values } = parseArgs({
  options: {
    rows: { type: "string", default: "5000" },
    seed: { type: "string", default: "42" },
    "error-rate": { type: "string", default: "0.06" },
    out: { type: "string", default: "data/seed.csv" },
    load: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log("Usage: npm run seed -- [--rows 5000] [--seed 42] [--error-rate 0.06] [--out data/seed.csv] [--load]");
  process.exit(0);
}

const rows = Number(values.rows);
const seed = Number(values.seed);
const errorRate = Number(values["error-rate"]);
if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(seed) || !(errorRate >= 0 && errorRate <= 1)) {
  console.error("--rows and --seed must be whole numbers (rows ≥ 1) and --error-rate between 0 and 1");
  process.exit(2);
}

const today = todayUtc();
const generated = generate({ rows, seed, errorRate, today });
const bytes = Buffer.from(generated.csv, "utf8");
mkdirSync(dirname(values.out), { recursive: true });
writeFileSync(values.out, bytes);
console.log(`Wrote ${values.out}: ${generated.rowsRead} rows, ${generated.expectedRejected} deliberately broken`);

const analysis = analyse(bytes, today);
const ok = analysis.rowsRead === generated.rowsRead && analysis.rejectedRows === generated.expectedRejected;
console.log(
  `Importer check: read ${analysis.rowsRead}, accepted ${analysis.accepted.length}, rejected ${analysis.rejectedRows} → ${ok ? "matches" : "MISMATCH"}`,
);
if (!ok) process.exit(1);

if (values.load) {
  const dbPath = process.env.DATABASE_PATH ?? "data/portal.db";
  const db = openDb(dbPath);
  const summary = applyImport(db, analysis, { name: values.out.split("/").pop()!, bytes });
  db.close();
  console.log(
    `Loaded into ${dbPath}: ${summary.created} new, ${summary.updated} updated, ${summary.unchanged} unchanged, ${summary.rejected} rejected`,
  );
}
