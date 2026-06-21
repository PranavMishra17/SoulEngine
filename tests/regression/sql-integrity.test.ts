/**
 * Regression test: SQL schema integrity constraints.
 *
 * Guards two specific schema requirements:
 *
 * 1. npc_instance_history must have a UNIQUE (instance_id, version) constraint.
 *    The optimistic-locking implementation in supabase/instances.ts relies on
 *    a unique constraint violation (error code 23505) when a concurrent save
 *    tries to archive the same version twice. Without the constraint, concurrent
 *    saves silently duplicate history rows instead of failing cleanly.
 *
 * 2. knowledge_categories must have a `description` column.
 *    The KnowledgeCategory type carries a description field; the local backend
 *    persists it but the Supabase backend lacked the column, causing silent
 *    data loss on round-trips.
 *
 * These tests read the SQL source files and assert the required DDL is present.
 * They will fail if:
 *   - the constraint / column is missing from the schema files, OR
 *   - someone removes them from the migration files.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SQL_DIR = path.resolve(__dirname, '../../sql');

function readSqlDir(): string {
  const files = fs.readdirSync(SQL_DIR).filter(f => f.endsWith('.sql'));
  return files.map(f => fs.readFileSync(path.join(SQL_DIR, f), 'utf-8')).join('\n');
}

describe('SQL integrity: npc_instance_history UNIQUE constraint', () => {
  it('npc_instance_history has a UNIQUE (instance_id, version) constraint in the SQL files', () => {
    const allSql = readSqlDir();

    // The constraint can appear as:
    //   UNIQUE (instance_id, version)                   -- inline in CREATE TABLE
    //   UNIQUE(instance_id, version)                    -- no space
    //   ADD CONSTRAINT ... UNIQUE (instance_id, version) -- ALTER TABLE migration
    // We accept any form that explicitly pairs instance_id and version in a UNIQUE clause.
    const hasConstraint =
      /UNIQUE\s*\(\s*instance_id\s*,\s*version\s*\)/i.test(allSql) ||
      /UNIQUE\s*\(\s*version\s*,\s*instance_id\s*\)/i.test(allSql);

    expect(hasConstraint).toBe(true);
  });
});

describe('SQL integrity: knowledge_categories description column', () => {
  it('knowledge_categories table includes a description column in the SQL files', () => {
    const allSql = readSqlDir();

    // The column can appear as:
    //   description TEXT ...                     -- in CREATE TABLE
    //   ADD COLUMN IF NOT EXISTS description ...  -- in ALTER TABLE
    // We check for the word "description" used as a column definition context
    // within or near the knowledge_categories table block.
    //
    // A simpler reliable check: the SQL files contain a column named "description"
    // associated with knowledge_categories. We look for either pattern:
    //   1. In a CREATE TABLE knowledge_categories block that contains "description"
    //   2. An ALTER TABLE ... knowledge_categories ... ADD COLUMN ... description
    const hasCreateWithDesc =
      /CREATE TABLE (?:IF NOT EXISTS )?public\.knowledge_categories\s*\([^)]*description\s+TEXT/is.test(allSql);

    const hasAlterWithDesc =
      /ALTER TABLE (?:IF EXISTS )?public\.knowledge_categories\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+description\s+TEXT/is.test(allSql);

    expect(hasCreateWithDesc || hasAlterWithDesc).toBe(true);
  });
});
