// Property check: for many generated files, the importer rejects exactly the
// rows the generator broke on purpose, and accepts every messy-but-valid row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generate } from "../scripts/generate.ts";
import { analyse } from "../src/analyse.ts";

const today = { year: 2026, month: 11, day: 18 };

test("importer verdict matches the generator's ground truth across 20 random files", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const g = generate({ rows: 500, seed, errorRate: 0.15, today });
    const a = analyse(new TextEncoder().encode(g.csv), today);
    assert.deepEqual(
      { read: a.rowsRead, rejected: a.rejectedRows },
      { read: g.rowsRead, rejected: g.expectedRejected },
      `seed ${seed}`,
    );
  }
});

test("a file with no deliberate errors imports every row", () => {
  const g = generate({ rows: 2000, seed: 7, errorRate: 0, today });
  const a = analyse(new TextEncoder().encode(g.csv), today);
  assert.deepEqual([a.accepted.length, a.rejectedRows], [2000, 0], JSON.stringify(a.problems.slice(0, 3)));
});
