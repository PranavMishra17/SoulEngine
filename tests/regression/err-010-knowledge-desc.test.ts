import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ERR-010: Supabase knowledge mapping hardcodes description to empty string
 *
 * Bug: src/storage/supabase/knowledge.ts lines 58 and 338 hardcode `description: ''`
 * when converting between database rows and KnowledgeCategory objects, causing
 * data loss on round-trips through Supabase.
 *
 * The KnowledgeCategory type requires a description field, and local storage
 * preserves it correctly, but Supabase silently destroys it.
 */
describe('ERR-010: knowledge category description preservation', () => {
  it('supabase knowledge module should not hardcode empty description strings', () => {
    // Read the source file to detect the bug
    const supabaseKnowledgePath = path.resolve(
      __dirname,
      '../../src/storage/supabase/knowledge.ts'
    );
    const moduleSource = fs.readFileSync(supabaseKnowledgePath, 'utf-8');

    // Count occurrences of hardcoded empty description
    // The bug appears at lines 58 and 338: description: ''
    const matches = moduleSource.match(/description:\s*['"]{2}/g);

    // Should have zero hardcoded empty descriptions after fix
    // Currently has at least 2 (lines 58 and 338)
    expect(matches?.length || 0).toBe(0);
  });

  it('demonstrates expected behavior after fix', () => {
    // This test documents the expected behavior after fixing the bug
    // The actual implementation test is above (source code check)

    // Given a category with description
    const inputCategory = {
      id: 'test-category',
      description: 'Important category information',
      depths: {
        1: 'Basic info',
        2: 'Detailed info'
      }
    };

    // The description field is part of the KnowledgeCategory type contract
    // and should be preserved through database round-trips

    // After fix:
    // - rowsToKnowledgeBase should populate description from DB or preserve from input
    // - getCategory should populate description from DB or preserve from input
    // - The DB schema may need a description column, OR
    // - Description becomes optional in the type, OR
    // - Description is stored in a metadata field

    expect(inputCategory.description).toBeTruthy();
    expect(inputCategory.description).toBe('Important category information');
  });
});
