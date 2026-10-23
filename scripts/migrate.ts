import { Database } from "../electron/database.js";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL");
const db = new Database(url);
try {
  await db.migrate(process.cwd());
  console.log("Schema ready");
} finally {
  await db.close();
}
