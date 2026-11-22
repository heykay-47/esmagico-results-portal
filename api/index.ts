import { attachDatabasePool } from "@vercel/functions";
import { postgresPool, postgresStore } from "../src/postgres.ts";
import { createPortal } from "../src/server.ts";

export const config = { api: { bodyParser: false } };

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for the hosted portal.");

const pool = postgresPool(url);
attachDatabasePool(pool);

export default createPortal(postgresStore(pool), {
  serveStatic: false,
  uploadLimit: 4 * 1024 * 1024,
  requireImportPassword: true,
  importPassword: process.env.DEMO_IMPORT_PASSWORD,
});
