import type { Approval, AgentAction } from './types';
import type { APITool, APIMessage, Completion, ToolCall } from './provider';
import type { WorkspaceTools } from './workspace';
import { CODE_SYSTEM } from './prompts';
import { id, safePath } from './paths';

export const CODE_TOOLS: APITool[] = [
  { type: 'function', function: { name: 'list_files', description: 'List text files in the selected app-local project sandbox.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'read_file', description: 'Read a text file from the selected project.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'write_file', description: 'Create or overwrite an app-local text file after approval.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } } },
  { type: 'function', function: { name: 'replace_in_file', description: 'Replace exactly one occurrence of a literal string in a text file, after approval.', parameters: { type: 'object', properties: { path: { type: 'string' }, search: { type: 'string' }, replacement: { type: 'string' } }, required: ['path', 'search', 'replacement'], additionalProperties: false } } },
  { type: 'function', function: { name: 'delete_file', description: 'Delete an app-local text file, after approval.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } }
];

const MUTATIONS = new Set<AgentAction>(['write_file', 'replace_in_file', 'delete_file']);
const ALLOWED = new Set<AgentAction>(['list_files', 'read_file', ...MUTATIONS]);
const MAX_ROUNDS = 8;
const MAX_CALLS = 24;

export type AgentResult = { finalText: string; toolCount: number; approvals: number };
export type AgentDependencies = {
  complete(messages: APIMessage[], tools: APITool[], signal?: AbortSignal): Promise<Completion>;
  workspace: WorkspaceTools;
  approve(action: Approval): Promise<boolean>;
  onMutation?(change: { tool: AgentAction; path: string }): void | Promise<void>;
  event(entry: { type: 'assistant' | 'tool'; text: string }): void;
  signal?: AbortSignal;
  externalTools?: APITool[];
  externalExecutor?: (name: string, args: Record<string, unknown>) => Promise<string>;
  approveReads?: boolean;
};

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Agent stopped');
}
function argsFrom(call: ToolCall): Record<string, unknown> {
  const args = JSON.parse(call.function.arguments || '{}');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments');
  return args as Record<string, unknown>;
}
function textArg(args: Record<string, unknown>, key: string) {
  if (typeof args[key] !== 'string') throw new Error('Expected string argument: ' + key);
  return args[key] as string;
}

async function executeTool(name: AgentAction, args: Record<string, unknown>, tools: WorkspaceTools): Promise<string> {
  if (name === 'list_files') return JSON.stringify(await tools.list_files());
  const path = safePath(textArg(args, 'path'));
  if (name === 'read_file') return (await tools.read_file({ path })).slice(0, 180_000);
  if (name === 'write_file') return tools.write_file({ path, content: textArg(args, 'content') });
  if (name === 'replace_in_file') return tools.replace_in_file({ path, search: textArg(args, 'search'), replacement: textArg(args, 'replacement') });
  if (name === 'delete_file') return tools.delete_file({ path });
  throw new Error('Unknown tool');
}

/**
 * Agent loop executes inside the React Native JS runtime, not on a remote shell.
 * The only writes it can make are in the selected app sandbox, with a human approval.
 */
export async function runCodeAgent(history: APIMessage[], deps: AgentDependencies): Promise<AgentResult> {
  const messages: APIMessage[] = [{ role: 'system', content: CODE_SYSTEM }, ...history];
  let toolCount = 0;
  let approvals = 0;
  let finalText = '';

  for (let round = 0; round < MAX_ROUNDS; round++) {
    checkAbort(deps.signal);
    const response = await deps.complete(messages, [...CODE_TOOLS,...(deps.externalTools||[])], deps.signal);
    checkAbort(deps.signal);
    const calls = response.toolCalls;
    messages.push({
      role: 'assistant', content: response.content || null,
      ...(calls.length ? { tool_calls: calls } : {})
    });
    if (response.content.trim()) {
      finalText = response.content.trim();
      deps.event({ type: 'assistant', text: finalText });
    }
    if (!calls.length) return { finalText, toolCount, approvals };

    if (calls.length > MAX_CALLS - toolCount) throw new Error('Agent tool-call limit reached');
    for (const call of calls) {
      checkAbort(deps.signal);
      toolCount++;
      let result = '';
      const name = call.function.name as AgentAction;
      try {
        const external = (deps.externalTools||[]).find(tool=>tool.function.name===name);
        const args = argsFrom(call);
        if (external) {
          approvals++;
          const accepted=await deps.approve({
            id:id('approval'),tool:'external_tool',path:external.function.name,
            description:'MCP eksternal meminta izin: '+external.function.description.slice(0,150),
            proposed:JSON.stringify(args,null,2).slice(0,5000)
          });
          checkAbort(deps.signal);
          result=accepted?(await deps.externalExecutor?.(name,args) || 'Tidak ada executor MCP'):'DENIED BY USER. No call sent.';
        } else {
        if (!ALLOWED.has(name)) throw new Error('Tool is not allowed: ' + String(name));
        if (deps.approveReads && (name==='read_file'||name==='list_files')) {
          approvals++;
          const accepted=await deps.approve({
            id:id('approval'),tool:name,path: name==='list_files'?'[daftar proyek]':safePath(textArg(args,'path')),
            description:'Beri akses baca file proyek?',
            proposed:JSON.stringify(args,null,2).slice(0,3000)
          });
          checkAbort(deps.signal);
          if(!accepted){result='DENIED BY USER. No file read.';}
        }
        if (result!=='DENIED BY USER. No file read.' && MUTATIONS.has(name)) {
          const preview = await deps.workspace.preview(name, args);
          approvals++;
          const accepted = await deps.approve({
            id: id('approval'),
            tool: name,
            path: safePath(textArg(args, 'path')),
            proposed: preview,
            description: 'LUMAVUN requests permission to ' + name + ' in the selected project'
          });
          checkAbort(deps.signal);
          if (!accepted) {
            result = 'DENIED BY USER. No changes made.';
          } else {
            result = await executeTool(name, args, deps.workspace);
            // Successful mutations are surfaced to the artifact gallery.
            try {
              await deps.onMutation?.({ tool: name, path: safePath(textArg(args, 'path')) });
            } catch {
              deps.event({ type: 'tool', text: 'Artefak gagal diperbarui; perubahan file tetap tersimpan.' });
            }
          }
        } else if (result!=='DENIED BY USER. No file read.') {
          result = await executeTool(name, args, deps.workspace);
        }
        }
      } catch (error) {
        result = 'ERROR: ' + (error instanceof Error ? error.message : 'Unexpected tool error');
      }
      deps.event({ type: 'tool', text: name + ': ' + result.slice(0, 180) });
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.slice(0, 180_000) });
    }
  }
  const limitMessage = 'Stopped after 8 agent rounds. Review the project; additional steps need a new request.';
  deps.event({ type: 'assistant', text: limitMessage });
  return { finalText: limitMessage, toolCount, approvals };
}
