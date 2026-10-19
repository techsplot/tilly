import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "drizzle");

type Journal = { entries: Array<{ tag: string }> };

// A copy of the migrations that stops just before the rename, so rows can
// be written the way an existing database holds them.
function migrationsBefore(tag: string): string {
  const folder = mkdtempSync(join(tmpdir(), "tilly-migrations-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
  const stop = journal.entries.findIndex((entry) => entry.tag === tag);
  journal.entries = journal.entries.slice(0, stop);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

describe("Tilly wake word migration", () => {
  let client: PGlite;
  let olderMigrations: string;

  beforeAll(async () => {
    client = new PGlite();
    olderMigrations = migrationsBefore("0006_tilly_wake_word");
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: olderMigrations });

    await client.query(
      `insert into farms (name, session_id) values ('Old Default', 's1')`,
    );
    await client.query(
      `insert into farms (name, session_id, wake_word) values
        ('Ok Farm', 's1', 'ok farm'),
        ('Hey Farm', 's1', 'hey farm'),
        ('Custom', 's1', 'hey buddy')`,
    );

    await migrate(db, { migrationsFolder: MIGRATIONS });
  });

  afterAll(async () => {
    await client.close();
    rmSync(olderMigrations, { recursive: true, force: true });
  });

  async function wakeWord(name: string): Promise<string> {
    const result = await client.query<{ wake_word: string }>(
      `select wake_word from farms where name = $1`,
      [name],
    );
    return result.rows[0]!.wake_word;
  }

  it("moves farms on the old default to Hey Tilly", async () => {
    expect(await wakeWord("Old Default")).toBe("hey tilly");
  });

  it("leaves other presets and custom wake words alone", async () => {
    expect(await wakeWord("Ok Farm")).toBe("ok farm");
    expect(await wakeWord("Hey Farm")).toBe("hey farm");
    expect(await wakeWord("Custom")).toBe("hey buddy");
  });

  it("gives new farms Hey Tilly by default", async () => {
    await client.query(
      `insert into farms (name, session_id) values ('New Farm', 's2')`,
    );
    expect(await wakeWord("New Farm")).toBe("hey tilly");
  });
});
