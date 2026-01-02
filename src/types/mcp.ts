export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  id?: string;
}

export interface ToolResult {
  tool_call_id: string;
  result: unknown;
  error?: string;
}

export interface ToolPermission {
  allowed: boolean;
  reason?: string;
}

