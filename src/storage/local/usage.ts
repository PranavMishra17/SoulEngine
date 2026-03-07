import { createLogger } from '../../logger.js';
import type {
    ProjectUsageTotals,
    ConversationTranscript,
    ConversationTranscriptSummary,
    SessionTokenUsage,
} from '../../types/usage.js';
import { emptyTokenUsage } from '../../types/usage.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = createLogger('local-usage');

const DATA_DIR = process.env.DATA_DIR || './data';

function getProjectDir(projectId: string): string {
    return path.join(DATA_DIR, 'projects', projectId);
}

function getUsageFile(projectId: string): string {
    return path.join(getProjectDir(projectId), 'usage.json');
}

function getTranscriptsDir(projectId: string): string {
    return path.join(getProjectDir(projectId), 'transcripts');
}

export async function getProjectUsage(projectId: string): Promise<ProjectUsageTotals> {
    try {
        const content = await fs.readFile(getUsageFile(projectId), 'utf-8');
        return JSON.parse(content) as ProjectUsageTotals;
    } catch {
        return {
            total_conversations: 0,
            ...emptyTokenUsage(),
            updated_at: new Date().toISOString(),
        };
    }
}

export async function appendProjectUsage(
    projectId: string,
    sessionUsage: SessionTokenUsage
): Promise<void> {
    try {
        const current = await getProjectUsage(projectId);
        const updated: ProjectUsageTotals = {
            total_conversations: current.total_conversations + 1,
            text_input_tokens: current.text_input_tokens + sessionUsage.text_input_tokens,
            text_output_tokens: current.text_output_tokens + sessionUsage.text_output_tokens,
            voice_input_chars: current.voice_input_chars + sessionUsage.voice_input_chars,
            voice_output_chars: current.voice_output_chars + sessionUsage.voice_output_chars,
            updated_at: new Date().toISOString(),
        };
        const dir = getProjectDir(projectId);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(getUsageFile(projectId), JSON.stringify(updated, null, 2), 'utf-8');
        logger.debug({ projectId }, 'Project usage updated');
    } catch (error) {
        logger.warn(
            { projectId, error: error instanceof Error ? error.message : 'Unknown' },
            'Failed to append project usage (non-fatal)'
        );
        // Don't throw — usage tracking must not break session cleanup
    }
}

export async function saveConversationTranscript(transcript: ConversationTranscript): Promise<void> {
    try {
        const dir = getTranscriptsDir(transcript.project_id);
        await fs.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, `${transcript.id}.json`);
        await fs.writeFile(filePath, JSON.stringify(transcript, null, 2), 'utf-8');
        logger.debug(
            { transcriptId: transcript.id, projectId: transcript.project_id },
            'Transcript saved'
        );
    } catch (error) {
        logger.warn(
            { projectId: transcript.project_id, error: error instanceof Error ? error.message : 'Unknown' },
            'Failed to save transcript (non-fatal)'
        );
        // Don't throw
    }
}

export async function listConversationTranscripts(
    projectId: string,
    limit = 50
): Promise<ConversationTranscriptSummary[]> {
    try {
        const dir = getTranscriptsDir(projectId);
        let files: string[];
        try {
            files = await fs.readdir(dir);
        } catch {
            return []; // Directory doesn't exist yet — no transcripts
        }

        const jsonFiles = files
            .filter((f) => f.endsWith('.json'))
            .sort()
            .reverse()
            .slice(0, limit);

        const summaries: ConversationTranscriptSummary[] = [];
        for (const file of jsonFiles) {
            try {
                const content = await fs.readFile(path.join(dir, file), 'utf-8');
                const t = JSON.parse(content) as ConversationTranscript;
                summaries.push({
                    id: t.id,
                    project_id: t.project_id,
                    npc_id: t.npc_id,
                    player_id: t.player_id,
                    session_id: t.session_id,
                    started_at: t.started_at,
                    ended_at: t.ended_at,
                    mode: t.mode,
                    message_count: t.messages.length,
                    token_usage: t.token_usage,
                });
            } catch {
                // Skip malformed transcript files
            }
        }
        return summaries;
    } catch (error) {
        logger.warn(
            { projectId, error: error instanceof Error ? error.message : 'Unknown' },
            'Failed to list transcripts'
        );
        return [];
    }
}

export async function getConversationTranscript(
    projectId: string,
    transcriptId: string
): Promise<ConversationTranscript | null> {
    try {
        const filePath = path.join(getTranscriptsDir(projectId), `${transcriptId}.json`);
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content) as ConversationTranscript;
    } catch {
        return null;
    }
}

export async function deleteTranscriptsByNpc(
    projectId: string,
    npcId: string
): Promise<number> {
    const dir = getTranscriptsDir(projectId);
    let files: string[];
    try {
        files = await fs.readdir(dir);
    } catch {
        return 0;
    }

    let deleted = 0;
    for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
            const content = await fs.readFile(path.join(dir, file), 'utf-8');
            const t = JSON.parse(content);
            if (t.npc_id === npcId) {
                await fs.unlink(path.join(dir, file));
                deleted++;
            }
        } catch {
            // Skip unreadable files
        }
    }

    logger.info({ projectId, npcId, deleted }, 'Transcripts deleted for NPC');
    return deleted;
}
