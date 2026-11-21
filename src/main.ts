import { openDb } from "./db.ts";
import { createApp } from "./server.ts";

const port = Number(process.env.PORT ?? 8080);
const dbPath = process.env.DATABASE_PATH ?? "data/portal.db";

const db = openDb(dbPath);
const server = createApp(db).listen(port, () => {
  console.log(`Student Results Portal on http://localhost:${port} (database: ${dbPath})`);
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
