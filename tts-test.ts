/**
 * TTS Provider Test Script
 * Run: npx ts-node tts-test.ts
 * Or: bun run tts-test.ts
 */

import 'dotenv/config';
import { createWriteStream } from 'fs';
import { CartesiaTtsProvider } from './src/providers/tts/cartesia.js';
import { ElevenLabsTtsProvider } from './src/providers/tts/elevenlabs.js';
import type { TTSProvider, TTSSessionEvents } from './src/providers/tts/interface.js';

const TEST_TEXT = "Hello! I am an NPC in your game. How can I help you today? I have memories of our past conversations and I remember that you helped me find my lost sword.";

// Default voice IDs - replace with your own
const CARTESIA_VOICE_ID = process.env.CARTESIA_VOICE_ID || 'a0e99841-438c-4a64-b679-ae501e7d6091';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel

async function testProvider(
  name: string,
  provider: TTSProvider,
  voiceId: string
): Promise<void> {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Testing: ${name}`);
  console.log(`Voice ID: ${voiceId}`);
  console.log(`${'='.repeat(50)}\n`);

  const outputFile = `test-output-${name.toLowerCase()}.pcm`;
  const fileStream = createWriteStream(outputFile);
  
  let totalBytes = 0;
  let chunkCount = 0;
  const startTime = Date.now();
  let firstChunkTime: number | null = null;

  const events: TTSSessionEvents = {
    onAudioChunk: (chunk) => {
      if (firstChunkTime === null) {
        firstChunkTime = Date.now();
        console.log(`  [${name}] First chunk latency: ${firstChunkTime - startTime}ms`);
      }
      
      chunkCount++;
      totalBytes += chunk.audio.length;
      fileStream.write(chunk.audio);
      
      console.log(`  [${name}] Chunk #${chunkCount}: ${chunk.audio.length} bytes`);
    },
    onComplete: () => {
      const totalTime = Date.now() - startTime;
      fileStream.end();
      
      console.log(`\n  [${name}] Complete!`);
      console.log(`  [${name}] Total chunks: ${chunkCount}`);
      console.log(`  [${name}] Total bytes: ${totalBytes}`);
      console.log(`  [${name}] Total time: ${totalTime}ms`);
      console.log(`  [${name}] Output saved to: ${outputFile}`);
    },
    onError: (error) => {
      console.error(`  [${name}] ERROR: ${error.message}`);
      fileStream.end();
    },
  };

  try {
    console.log(`  [${name}] Creating session...`);
    
    const session = await provider.createSession(
      {
        voiceId,
        sampleRate: 44100,
        outputFormat: 'pcm_s16le',
      },
      events
    );

    console.log(`  [${name}] Session created, connected: ${session.isConnected}`);
    console.log(`  [${name}] Synthesizing: "${TEST_TEXT.slice(0, 50)}..."`);

    await session.synthesize(TEST_TEXT);
    await session.flush();

    // Wait a bit for final chunks
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log(`  [${name}] Closing session...`);
    session.close();

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  [${name}] FAILED: ${msg}`);
    
    if (error instanceof Error && error.stack) {
      console.error(`  [${name}] Stack: ${error.stack}`);
    }
  }
}

async function main() {
  console.log('TTS Provider Test Script');
  console.log('========================\n');

  // Check API keys
  const cartesiaKey = process.env.CARTESIA_API_KEY;
  const elevenlabsKey = process.env.ELEVENLABS_API_KEY;

  console.log('API Key Status:');
  console.log(`  CARTESIA_API_KEY: ${cartesiaKey ? 'SET (' + cartesiaKey.length + ' chars)' : 'MISSING'}`);
  console.log(`  ELEVENLABS_API_KEY: ${elevenlabsKey ? 'SET (' + elevenlabsKey.length + ' chars)' : 'MISSING'}`);

  // Test Cartesia
  if (cartesiaKey) {
    try {
      const cartesia = new CartesiaTtsProvider({ apiKey: cartesiaKey });
      await testProvider('Cartesia', cartesia, CARTESIA_VOICE_ID);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`\nCartesia provider init failed: ${msg}`);
    }
  } else {
    console.log('\nSkipping Cartesia - no API key');
  }

  // Test ElevenLabs
  if (elevenlabsKey) {
    try {
      const elevenlabs = new ElevenLabsTtsProvider({ apiKey: elevenlabsKey });
      await testProvider('ElevenLabs', elevenlabs, ELEVENLABS_VOICE_ID);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`\nElevenLabs provider init failed: ${msg}`);
    }
  } else {
    console.log('\nSkipping ElevenLabs - no API key');
  }

  console.log('\n\nDone! Check the .pcm files for audio output.');
  console.log('To play PCM: ffplay -f s16le -ar 44100 -ac 1 test-output-cartesia.pcm');
}

main().catch(console.error);
