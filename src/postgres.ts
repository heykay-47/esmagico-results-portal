import { createHash } from "node:crypto";
import { Pool } from "pg";
import {
  SCHEMA,
  SUBJECT_COLS,
  rowToDetail,
  rowToListItem,
  sameStudent,
  searchKey,
  studentListSql,
  toSummary,
  type ImportRow,
  type ResultsStore,
} from "./db.ts";

const schema = SCHEMA.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY")
  .replaceAll(" REAL ", " DOUBLE PRECISION ");
const bind = (sql: string) => {
  let i = 0;
  return sql.replaceAll("?", () => `$${++i}`);
};

export function postgresPool(connectionString: string) {
  return new Pool({ connectionString, max: 3, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 10_000 });
}

export async function migratePostgres(pool: Pool) {
  await pool.query(schema);
}

export function postgresStore(pool: Pool): ResultsStore {
  return {
    async applyImport(analysis, file) {
      const hash = createHash("sha256").update(file.bytes).digest("hex");
      const now = new Date().toISOString();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Serialize imports so concurrent requests classify new, updated and unchanged rows correctly.
        await client.query("SELECT pg_advisory_xact_lock(630941)");
        const previous = await client.query<{ created_at: string }>(
          "SELECT created_at FROM imports WHERE file_sha256 = $1 ORDER BY id LIMIT 1", [hash],
        );
        const { rows: [{ id }] } = await client.query<{ id: number }>(
          `INSERT INTO imports (file_name, file_size, file_sha256, created_at, rows_read, created, updated, unchanged, rejected, ignored_columns, problems)
           VALUES ($1, $2, $3, $4, $5, 0, 0, 0, $6, $7, $8) RETURNING id`,
          [file.name, file.bytes.length, hash, now, analysis.rowsRead, analysis.rejectedRows,
            JSON.stringify(analysis.ignoredColumns), JSON.stringify(analysis.problems)],
        );

        const columns = ["student_id", "full_name", "name_search", "email", "date_of_birth", "grade_level",
          "section", ...SUBJECT_COLS, "import_id", "updated_at"];
        let created = 0;
        let updated = 0;
        let unchanged = 0;
        for (let i = 0; i < analysis.accepted.length; i += 500) {
          const batch = analysis.accepted.slice(i, i + 500);
          const { rows } = await client.query(
            "SELECT * FROM students WHERE student_id = ANY($1::text[])", [batch.map(({ student }) => student.studentId)],
          );
          const existing = new Map(rows.map((row) => [row.student_id, row]));
          const values = batch.flatMap(({ student: s }) => {
            const prior = existing.get(s.studentId);
            if (prior && sameStudent(prior, s)) {
              unchanged++;
              return [];
            }
            if (prior) updated++;
            else created++;
            return [[s.studentId, s.fullName, searchKey(s.fullName), s.email, s.dateOfBirth, s.gradeLevel,
              s.section, ...SUBJECT_COLS.map((c) => s.marks[c]), id, now]];
          });
          if (values.length) {
            const placeholders = values.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
            await client.query(bind(
              `INSERT INTO students (${columns.join(", ")}) VALUES ${placeholders}
               ON CONFLICT (student_id) DO UPDATE SET ${columns.slice(1).map((c) => `${c} = excluded.${c}`).join(", ")}`,
            ), values.flat());
          }
        }
        const { rows: [summary] } = await client.query<ImportRow>(
          "UPDATE imports SET created = $1, updated = $2, unchanged = $3 WHERE id = $4 RETURNING *",
          [created, updated, unchanged, id],
        );
        const result = toSummary(summary, previous.rows[0]?.created_at ?? null);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async getImport(id) {
      const { rows: [row] } = await pool.query<ImportRow>("SELECT * FROM imports WHERE id = $1", [id]);
      return row ? toSummary(row, null) : null;
    },
    async getImportProblems(id) {
      const { rows: [row] } = await pool.query<{ problems: string }>("SELECT problems FROM imports WHERE id = $1", [id]);
      return row ? JSON.parse(row.problems) : null;
    },
    async listImports() {
      const { rows } = await pool.query<ImportRow>("SELECT * FROM imports ORDER BY id DESC LIMIT 10");
      return rows.map((row) => toSummary(row, null));
    },
    async listStudents(query) {
      const sql = studentListSql(query);
      const [count, page] = await Promise.all([
        pool.query<{ n: string }>(bind(sql.count), sql.params),
        pool.query(bind(sql.page), [...sql.params, ...sql.pagination]),
      ]);
      return { total: Number(count.rows[0].n), items: page.rows.map(rowToListItem) };
    },
    async getStudent(id) {
      const { rows: [row] } = await pool.query("SELECT * FROM students WHERE student_id = $1", [id.trim().toUpperCase()]);
      return row ? rowToDetail(row) : null;
    },
  };
}
