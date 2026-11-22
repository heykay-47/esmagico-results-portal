import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generate } from "./generate.ts";
import { todayUtc } from "../src/rules.ts";

for (const file of ["css/tabler.min.css", "js/tabler.min.js"]) {
  const dest = `public/vendor/tabler/${file}`;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(`node_modules/@tabler/core/dist/${file}`, dest);
}

const { csv } = generate({ rows: 5000, seed: 42, errorRate: 0.06, today: todayUtc() });
writeFileSync("public/demo-results.csv", csv);
