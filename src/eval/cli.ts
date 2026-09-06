#!/usr/bin/env node

/**
 * CLI for running conversation replay evaluations.
 *
 * Usage: npm run eval [fixture-name]
 *
 * If no fixture name is provided, runs all fixtures in tests/fixtures/conversations/
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { runReplay } from './replay.js';
import { ConversationFixtureSchema } from '../schema/eval.js';
import type { ReplayReport } from './replay.js';

const FIXTURES_DIR = 'tests/fixtures/conversations';

/**
 * Print a turn report in a readable format.
 */
function printTurnReport(report: ReplayReport): void {
  console.log(`\nFixture: ${report.fixture}`);
  console.log('='.repeat(60));

  for (const turn of report.turns) {
    console.log(`\nTurn ${turn.turn}: ${turn.playerInput.substring(0, 60)}${turn.playerInput.length > 60 ? '...' : ''}`);
    const followUp = turn.timings.followUpMs === null ? '' : ` | Follow-up: ${turn.timings.followUpMs}ms`;
    console.log(`  Mind: ${turn.timings.mindDurationMs}ms | Speaker: ${turn.timings.speakerDurationMs}ms${followUp} | Total: ${turn.timings.totalMs}ms`);

    if (turn.recall.expectedFacts.length > 0) {
      const hitPercent = (turn.recall.hitRate * 100).toFixed(0);
      const status = turn.recall.hitRate === 1.0 ? 'PASS' : 'FAIL';
      console.log(`  Recall: ${turn.recall.factsInReply.length}/${turn.recall.expectedFacts.length} (${hitPercent}%) | ${status}`);
      if (turn.recall.hitRate < 1.0) {
        const missing = turn.recall.expectedFacts.filter(f => !turn.recall.factsInReply.includes(f));
        console.log(`    Missing from reply: ${missing.join(', ')}`);
        const inPrompt = turn.recall.expectedFacts.filter(f => turn.recall.factsInPrompt.includes(f));
        if (inPrompt.length > 0) {
          console.log(`    Present in prompt: ${inPrompt.join(', ')}`);
        }
      }
    }

    if (turn.tools.expectedCalls.length > 0) {
      const hitPercent = (turn.tools.accuracy * 100).toFixed(0);
      const status = turn.tools.accuracy === 1.0 ? 'PASS' : 'FAIL';
      console.log(`  Tools: ${turn.tools.actualCalls.length}/${turn.tools.expectedCalls.length} (${hitPercent}%) | ${status}`);
      if (turn.tools.unexpectedCalls.length > 0) {
        console.log(`    Unexpected: ${turn.tools.unexpectedCalls.join(', ')}`);
      }
    }
  }

  console.log('\n' + '-'.repeat(60));
  console.log('Aggregate Metrics:');
  console.log(`  Avg Mind Latency: ${report.aggregate.avgMindLatencyMs.toFixed(1)}ms`);
  console.log(`  Avg Speaker Latency: ${report.aggregate.avgSpeakerLatencyMs.toFixed(1)}ms`);
  console.log(`  Avg Total Latency: ${report.aggregate.avgTotalLatencyMs.toFixed(1)}ms`);
  console.log(`  Recall Hit Rate: ${(report.aggregate.recallHitRate * 100).toFixed(0)}%`);
  console.log(`  Tool Accuracy: ${(report.aggregate.toolAccuracy * 100).toFixed(0)}%`);
  console.log('='.repeat(60));
}

/**
 * Load and validate a fixture file.
 */
function loadFixture(path: string) {
  const content = readFileSync(path, 'utf-8');
  const json = JSON.parse(content);
  const parsed = ConversationFixtureSchema.safeParse(json);

  if (!parsed.success) {
    console.error(`Invalid fixture: ${path}`);
    console.error(parsed.error.issues);
    process.exit(1);
  }

  return parsed.data;
}

/**
 * Main entry point.
 */
async function main() {
  const fixtureName = process.argv[2];

  if (fixtureName) {
    // Run single fixture
    const fixturePath = join(FIXTURES_DIR, `${fixtureName}.json`);
    console.log(`Loading fixture: ${fixturePath}`);

    const fixture = loadFixture(fixturePath);
    const report = await runReplay(fixture);
    printTurnReport(report);
  } else {
    // Run all fixtures
    const files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));
    console.log(`Found ${files.length} fixture(s)`);

    for (const file of files) {
      const fixturePath = join(FIXTURES_DIR, file);
      const fixture = loadFixture(fixturePath);
      const report = await runReplay(fixture);
      printTurnReport(report);
    }
  }
}

main().catch(err => {
  console.error('Evaluation failed:', err);
  process.exit(1);
});
