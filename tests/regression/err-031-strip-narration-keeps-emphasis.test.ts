/**
 * ERR-031: stripNarration removed every asterisked span, so a model that
 * emphasised a name wrote "I remember *Kael* owes forty crowns" and the player
 * heard "I remember  owes forty crowns" (seen live on gemini-2.5-flash,
 * research/09-npc-runtime/BASELINE.md). Stage directions sit at a line or
 * sentence boundary; emphasis sits inside a clause and must be unwrapped, not
 * deleted.
 */
import { describe, it, expect } from 'vitest';
import { stripNarration } from '../../src/conversation/turn.js';

describe('ERR-031: stripNarration keeps emphasised words', () => {
  it('unwraps inline emphasis instead of deleting the word', () => {
    expect(stripNarration('I remember *Kael* owes forty crowns.')).toBe('I remember Kael owes forty crowns.');
    expect(stripNarration('That is *exactly* what I said.')).toBe('That is exactly what I said.');
  });

  it('still removes a stage direction at the start of a line', () => {
    expect(stripNarration('*shrugs* Fine, take it.')).toBe('Fine, take it.');
  });

  it('still removes a stage direction at the end of a line', () => {
    expect(stripNarration('Fine, take it. *walks away*')).toBe('Fine, take it.');
  });

  it('still removes a stage direction between sentences', () => {
    expect(stripNarration('Listen. *leans in* The key is under the mat.')).toBe('Listen. The key is under the mat.');
  });

  it('still drops a line that is nothing but narration', () => {
    expect(stripNarration('*The harbourmaster looks up from her ledger.*\nWhat do you want?')).toBe('What do you want?');
  });

  it('still removes parenthesised directions', () => {
    expect(stripNarration('(sighs) Alright, come in.')).toBe('Alright, come in.');
  });
});
