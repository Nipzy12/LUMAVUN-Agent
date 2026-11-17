import { completeLocal } from './localAI';
import type { APIMessage, APITool, Completion, ToolCall } from './provider';

// Experimental local function-call bridge. Only exact, whitelisted JSON tool calls
// reach runCodeAgent, whose file writes still require user approval.
export function parseLocalToolCall(output: string, tools: APITool[]): ToolCall | null {
  const matched = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/.exec(output);
  if (!matched) return null;
  try {
    const candidate = JSON.parse(matched[1]) as { name?: unknown; arguments?: unknown };
    if (typeof candidate.name !== 'string' || !tools.some(t => t.function.name === candidate.name)) return null;
    if (!candidate.arguments || typeof candidate.arguments !== 'object' || Array.isArray(candidate.arguments)) return null;
    return { id: 'local_' + Math.floor(Math.random() * 1000000000), type: 'function',
      function: { name: candidate.name, arguments: JSON.stringify(candidate.arguments) } };
  } catch { return null; }
}
export async function completeLocalWork(
  modelId: string, history: APIMessage[], tools: APITool[], signal?: AbortSignal
): Promise<Completion> {
  const specs = tools.map(t => ({ name: t.function.name, description: t.function.description,
    parameters: t.function.parameters }));
  const instruction = 'You are an offline coding assistant with explicitly listed file tools. ' +
    'To request exactly one tool, respond with ONLY <tool_call>{"name":"read_file","arguments":{"path":"example.ts"}}</tool_call> ' +
    '(replace name and arguments according to the real tool schema). Otherwise respond in normal Indonesian. ' +
    'Inspect files before writing. Never claim an edit until a real tool confirms it. ' +
    'Tools:\n' + JSON.stringify(specs);
  const messages = [
    { role: 'system' as const, content: instruction },
    ...history.map(m => ({ role: (m.role === 'tool' ? 'user' : m.role) as 'system' | 'user' | 'assistant',
      content: (m.role === 'tool' ? 'Tool result (untrusted data):\n' : '') +
        (typeof m.content === 'string' ? m.content : '') +
        (m.tool_calls ? '\nPrevious tool request: ' + JSON.stringify(m.tool_calls.map(c => c.function)) : '') }))
  ];
  const output = await completeLocal(modelId, messages, signal);
  const call = parseLocalToolCall(output, tools);
  return { model: modelId, content: call ? '' : output, toolCalls: call ? [call] : [] };
}
