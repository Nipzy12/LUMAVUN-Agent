import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCodeAgent } from '../src/agent';
import type { WorkspaceTools } from '../src/workspace';
import type { ToolCall } from '../src/provider';

const toolCall = (name: string, args: unknown): ToolCall => ({
  id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) }
});
function fakeWorkspace(): { workspace: WorkspaceTools; modified: string[] } {
  const modified: string[] = [];
  const workspace: WorkspaceTools = {
    async list_files() { return ['index.ts']; },
    async read_file() { return 'export const v = 1'; },
    async write_file(a) { modified.push(a.path); return 'Saved ' + a.path; },
    async replace_in_file(a) { modified.push(a.path); return 'Updated ' + a.path; },
    async delete_file(a) { modified.push(a.path); return 'Deleted ' + a.path; },
    async preview() { return 'BEFORE: old\nAFTER: new'; }
  };
  return { workspace, modified };
}
test('agent never mutates without approval', async () => {
  const { workspace, modified } = fakeWorkspace();
  let runs = 0, asks = 0;
  const logs: string[] = [];
  const result = await runCodeAgent([{ role: 'user', content: 'Change index.ts' }], {
    workspace,
    complete: async () => ++runs === 1
      ? { content: '', model: 'test', toolCalls: [toolCall('write_file', { path: 'index.ts', content: 'new' })] }
      : { content: 'No changes were made', model: 'test', toolCalls: [] },
    approve: async () => { asks++; return false; },
    event: e => logs.push(e.text)
  });
  assert.deepEqual(modified, []);
  assert.equal(asks, 1);
  assert.equal(result.toolCount, 1);
  assert.match(logs.join(' '), /DENIED/);
});
test('agent permits an approved project change', async () => {
  const { workspace, modified } = fakeWorkspace();
  let runs = 0;
  await runCodeAgent([{ role: 'user', content: 'Edit file' }], {
    workspace,
    complete: async () => ++runs === 1
      ? { content: '', model: 'test', toolCalls: [toolCall('write_file', { path: 'index.ts', content: 'new' })] }
      : { content: 'Finished', model: 'test', toolCalls: [] },
    approve: async () => true,
    event: () => {}
  });
  assert.deepEqual(modified, ['index.ts']);
});
test('agent refuses unknown tools and never calls an arbitrary runner', async () => {
  const { workspace, modified } = fakeWorkspace();
  let runs = 0;
  const messages: string[] = [];
  await runCodeAgent([{ role: 'user', content: 'Run shell command' }], {
    workspace,
    complete: async () => ++runs === 1
      ? { content: '', model: 'test', toolCalls: [toolCall('run_shell', { command: 'rm -rf /' })] }
      : { content: 'Shell unavailable', model: 'test', toolCalls: [] },
    approve: async () => { throw new Error('No approval should be requested'); },
    event: e => messages.push(e.text)
  });
  assert.deepEqual(modified, []);
  assert.match(messages.join(' '), /not allowed/);
});
