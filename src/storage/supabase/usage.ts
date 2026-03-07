import { getSupabaseAdmin } from './client.js';
import { createLogger } from '../../logger.js';
import type {
    ProjectUsageTotals,
    ConversationTranscript,
    ConversationTranscriptSummary,
    SessionTokenUsage,
} from '../../types/usage.js';
import { emptyTokenUsage } from '../../types/usage.js';

const logger = createLogger('supabase-usage');

export async function getProjectUsage(projectId: string): Promise<ProjectUsageTotals> {
    try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('project_usage')
            .select('*')
            .eq('project_id', projectId)
            .single();

        if (error || !data) {
            return { total_conversations: 0, ...emptyTokenUsage(), updated_at: new Date().toISOString() };
        }

        return {
            total_conversations: (data.total_conversations as number) ?? 0,
            text_input_tokens: (data.text_input_tokens as number) ?? 0,
            text_output_tokens: (data.text_output_tokens as number) ?? 0,
            voice_input_chars: (data.voice_input_chars as number) ?? 0,
            voice_output_chars: (data.voice_output_chars as number) ?? 0,
            updated_at: (data.updated_at as string) ?? new Date().toISOString(),
        };
    } catch (error) {
        logger.warn(
            { projectId, error: error instanceof Error ? error.message : 'Unknown' },
            'Failed to get project usage'
        );
        return { total_conversations: 0, ...emptyTokenUsage(), updated_at: new Date().toISOString() };
    }
}

export async function appendProjectUsage(
    projectId: string,
    sessionUsage: SessionTokenUsage
): Promise<void> {
    try {
        const supabase = getSupabaseAdmin();

        // Try atomic RPC first (defined in SQL migration 05-usage-tracking.sql)
        const { error } = await supabase.rpc('increment_project_usage', {
            p_project_id: projectId,
            p_text_input: sessionUsage.text_input_tokens,
            p_text_output: sessionUsage.text_output_tokens,
            p_voice_input_chars: sessionUsage.voice_input_chars,
            p_voice_output_chars: sessionUsage.voice_output_chars,
        });

        if (error) {
            logger.warn(
                { projectId, error: error.message },
                'RPC increment_project_usage failed, falling back to upsert'
            );
            // Fallback: read-modify-write upsert
            const current = await getProjectUsage(projectId);
            await supabase.from('project_usage').upsert(
                {
                    project_id: projectId,
                    total_conversations: current.total_conversations + 1,
                    text_input_tokens: current.text_input_tokens + sessionUsage.text_input_tokens,
                    text_output_tokens: current.text_output_tokens + sessionUsage.text_output_tokens,
                    voice_input_chars: current.voice_input_chars + sessionUsage.voice_input_chars,
                    voice_output_chars: current.voice_output_chars + sessionUsage.voice_output_chars,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'project_id' }
            );
        }
    } catch (error) {
        logger.warn(
            { projectId, error: error instanceof Error ? error.message : 'Unknown' },
            'Failed to append project usage (non-fatal)'
        );
        // Don't throw — never break session cleanup
    }
}

export async function saveConversationTranscript(transcript: ConversationTranscript): Promise<void> {
    try {
        const supabase = getSupabaseAdmin();
        const { error } = await supabase.from('conversation_transcripts').insert({
            id: transcript.id,
            project_id: transcript.project_id,
            npc_id: transcript.npc_id,
            player_id: transcript.player_id,
            session_id: transcript.session_id,
            started_at: transcript.started_at,
            ended_at: transcript.ended_at,
            mode: transcript.mode,
            messages: transcript.messages,
            token_usage: transcript.token_usage,
        });

        if (error) {
            logger.warn(
                { transcriptId: transcript.id, error: error.message },
                'Failed to save transcript'
            );
        }
    } catch (error) {
        logger.warn(
            {
                projectId: transcript.project_id,
                error: error instanceof Error ? error.message : 'Unknown',
            },
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
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('conversation_transcripts')
            .select('id, project_id, npc_id, player_id, session_id, started_at, ended_at, mode, token_usage, messages')
            .eq('project_id', projectId)
            .order('started_at', { ascending: false })
            .limit(limit);

        if (error || !data) return [];

        return data.map((r: Record<string, unknown>) => ({
            id: String(r.id),
            project_id: String(r.project_id),
            npc_id: String(r.npc_id),
            player_id: String(r.player_id),
            session_id: String(r.session_id),
            started_at: String(r.started_at),
            ended_at: String(r.ended_at),
            mode: String(r.mode),
            message_count: Array.isArray(r.messages) ? r.messages.length : 0,
            token_usage: (r.token_usage as SessionTokenUsage) ?? emptyTokenUsage(),
        }));
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
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('conversation_transcripts')
            .select('*')
            .eq('project_id', projectId)
            .eq('id', transcriptId)
            .single();

        if (error || !data) return null;
        return data as unknown as ConversationTranscript;
    } catch {
        return null;
    }
}

export async function deleteTranscriptsByNpc(
    projectId: string,
    npcId: string
): Promise<number> {
    try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('conversation_transcripts')
            .delete()
            .eq('project_id', projectId)
            .eq('npc_id', npcId)
            .select('id');

        if (error) {
            logger.warn({ projectId, npcId, error: error.message }, 'Failed to delete transcripts');
            return 0;
        }

        const deleted = data?.length ?? 0;
        logger.info({ projectId, npcId, deleted }, 'Transcripts deleted for NPC');
        return deleted;
    } catch (error) {
        logger.warn(
            { projectId, npcId, error: error instanceof Error ? error.message : 'Unknown' },
            'Failed to delete transcripts (non-fatal)'
        );
        return 0;
    }
}
