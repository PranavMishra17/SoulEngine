/**
 * ERR-028 -- a migration that could never run.
 *
 * `sql/07-session-and-integrity.sql` added a unique constraint and marked it
 * NOT VALID. Postgres accepts NOT VALID only on CHECK and FOREIGN KEY
 * constraints, so the statement failed with
 *
 *   ERROR: 0A000: UNIQUE constraints cannot be marked NOT VALID
 *
 * and took the rest of the file with it -- the session-persistence tables and
 * the knowledge_categories.description column never got created. Nothing in the
 * repo executes these files, so nothing caught it until a human pasted the file
 * into the SQL editor while setting up a new database.
 *
 * These files are the only definition of the production schema. This is a
 * static check, which is all that is possible without a live Postgres, but it
 * pins the specific mistake and the general rule behind it.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const SQL_DIR = path.join(process.cwd(), 'sql');

function sqlFiles(): { name: string; body: string }[] {
  return readdirSync(SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, body: readFileSync(path.join(SQL_DIR, name), 'utf-8') }));
}

/** Strip `--` line comments so prose about the bug is not mistaken for the bug. */
function withoutComments(body: string): string {
  return body
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

describe('ERR-028: the schema files are executable', () => {
  it('finds the migration files', () => {
    expect(sqlFiles().length).toBeGreaterThan(0);
  });

  it('never marks a UNIQUE constraint NOT VALID', () => {
    for (const { name, body } of sqlFiles()) {
      const sql = withoutComments(body);
      // ADD CONSTRAINT <name> UNIQUE (...) NOT VALID -- rejected by Postgres.
      const offence = /\bUNIQUE\s*\([^)]*\)\s*NOT\s+VALID/is.test(sql);
      expect(offence, `${name} marks a UNIQUE constraint NOT VALID`).toBe(false);
    }
  });

  it('never marks a PRIMARY KEY constraint NOT VALID', () => {
    for (const { name, body } of sqlFiles()) {
      const sql = withoutComments(body);
      const offence = /\bPRIMARY\s+KEY\s*\([^)]*\)\s*NOT\s+VALID/is.test(sql);
      expect(offence, `${name} marks a PRIMARY KEY constraint NOT VALID`).toBe(false);
    }
  });

  it('only uses NOT VALID on constraint types that accept it', () => {
    // Postgres accepts NOT VALID for CHECK and FOREIGN KEY only.
    for (const { name, body } of sqlFiles()) {
      const sql = withoutComments(body);
      for (const match of sql.matchAll(/([\s\S]{0,200}?)NOT\s+VALID/gi)) {
        const preceding = match[1];
        const allowed = /\b(CHECK|REFERENCES|FOREIGN\s+KEY)\b/i.test(preceding);
        expect(allowed, `${name}: NOT VALID applied to a constraint that cannot take it`).toBe(
          true
        );
      }
    }
  });

  it('keeps the uniqueness that optimistic locking depends on', () => {
    // instances.ts:183 treats SQLSTATE 23505 on the history insert as "another
    // save already archived this version". Drop the uniqueness and that check
    // silently stops firing, turning a detected conflict into duplicate rows.
    const body = sqlFiles().find((f) => f.name.startsWith('07'))?.body ?? '';
    expect(body).toMatch(/npc_instance_history[\s\S]*instance_id,\s*version/i);
  });
});
