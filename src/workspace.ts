import { Directory, File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { safePath } from './paths';
import type { AgentAction } from './types';

export const MAX_FILE_BYTES = 180_000;
export const MAX_FILES = 200;

function projectDirectory(projectId: string): Directory {
  if (!/^project-[a-z0-9-]{5,60}$/.test(projectId)) throw new Error('Invalid project ID');
  return new Directory(Paths.document, 'lumavun', 'projects', projectId);
}

function fileFor(projectId: string, input: string): File {
  const relative = safePath(input);
  return new File(projectDirectory(projectId), ...relative.split('/'));
}

function ensureParent(projectId: string, path: string): void {
  const parts = safePath(path).split('/');
  parts.pop();
  const dir = new Directory(projectDirectory(projectId), ...parts);
  dir.create({ idempotent: true, intermediates: true });
}

export function deleteProjectFolder(projectId: string) {
  const folder = projectDirectory(projectId);
  if (folder.exists) folder.delete();
}

export function createProjectFolder(projectId: string) {
  projectDirectory(projectId).create({ idempotent: true, intermediates: true });
}

export function listProjectFiles(projectId: string): string[] {
  const root = projectDirectory(projectId);
  if (!root.exists) return [];
  const paths: string[] = [];
  function walk(directory: Directory, prefix: string, depth: number) {
    if (depth > 10) return;
    for (const entry of directory.list()) {
      if (paths.length >= MAX_FILES) return;
      const path = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry instanceof Directory) {
        walk(entry, path, depth + 1);
      } else if (entry instanceof File) {
        paths.push(path);
      }
    }
  }
  walk(root, '', 0);
  return paths.sort();
}

export async function readProjectFile(projectId: string, path: string): Promise<string> {
  const file = fileFor(projectId, path);
  if (!file.exists) throw new Error('File does not exist: ' + path);
  if (file.size !== null && file.size > MAX_FILE_BYTES) throw new Error('File too large (>180 KB)');
  return file.text();
}

export async function writeProjectFile(projectId: string, path: string, content: string) {
  safePath(path);
  if (typeof content !== 'string' || content.length > MAX_FILE_BYTES) {
    throw new Error('Text file exceeds the 180 KB limit');
  }
  const file = fileFor(projectId, path);
  ensureParent(projectId, path);
  if (!file.exists) file.create();
  await file.write(content);
}

export function deleteProjectFile(projectId: string, path: string) {
  const file = fileFor(projectId, path);
  if (!file.exists) throw new Error('File does not exist: ' + path);
  file.delete();
}

export async function importTextFile(projectId: string): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  if (asset.size && asset.size > MAX_FILE_BYTES) throw new Error('Imported file exceeds 180 KB');
  // Only plain text is supported. Reject embedded binary bytes.
  const input = new File(asset.uri);
  const content = await input.text();
  if (content.includes('\0')) throw new Error('Only text files may be imported');
  const safeName = asset.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = safePath(safeName);
  // Imports never silently replace existing files.
  const existing = fileFor(projectId, filename);
  if (existing.exists) throw new Error('File already exists: ' + filename);
  await writeProjectFile(projectId, filename, content);
  return filename;
}

export async function shareProjectFile(projectId: string, path: string) {
  const file = fileFor(projectId, path);
  if (!file.exists) throw new Error('File not found');
  if (!await Sharing.isAvailableAsync()) throw new Error('Sharing is not available');
  await Sharing.shareAsync(file.uri);
}

export interface WorkspaceTools {
  list_files(): Promise<string[]>;
  read_file(args: { path: string }): Promise<string>;
  write_file(args: { path: string; content: string }): Promise<string>;
  replace_in_file(args: { path: string; search: string; replacement: string }): Promise<string>;
  delete_file(args: { path: string }): Promise<string>;
  preview(tool: AgentAction, args: Record<string, unknown>): Promise<string>;
}

export function createWorkspaceTools(projectId: string): WorkspaceTools {
  return {
    async list_files() { return listProjectFiles(projectId); },
    async read_file({ path }) { return readProjectFile(projectId, path); },
    async write_file({ path, content }) {
      const p = safePath(path);
      if (!listProjectFiles(projectId).includes(p) && listProjectFiles(projectId).length >= MAX_FILES) {
        throw new Error('Project file limit reached');
      }
      await writeProjectFile(projectId, p, content);
      return 'Saved ' + p;
    },
    async replace_in_file({ path, search, replacement }) {
      if (!search) throw new Error('Replacement search cannot be empty');
      const current = await readProjectFile(projectId, path);
      const count = current.split(search).length - 1;
      if (count !== 1) throw new Error('Expected exactly one match; found ' + count);
      await writeProjectFile(projectId, path, current.replace(search, replacement));
      return 'Updated ' + safePath(path);
    },
    async delete_file({ path }) {
      deleteProjectFile(projectId, path);
      return 'Deleted ' + safePath(path);
    },
    async preview(tool, args) {
      const path = safePath(String(args.path || ''));
      let oldText = '';
      try { oldText = await readProjectFile(projectId, path); } catch { /* new file */ }
      let proposed = '';
      if (tool === 'write_file') proposed = String(args.content ?? '');
      if (tool === 'replace_in_file') {
        const search = String(args.search ?? '');
        const replacement = String(args.replacement ?? '');
        if (!search || oldText.split(search).length - 1 !== 1) {
          throw new Error('Replace requires exactly one current match');
        }
        proposed = oldText.replace(search, replacement);
      }
      if (tool === 'delete_file') proposed = '[DELETE FILE]';
      const crop = (s: string) => s.length > 2800 ? s.slice(0, 2800) + '\n…(truncated)' : s;
      return 'FILE: ' + path + '\n\nBEFORE:\n' + crop(oldText || '(empty / new file)') +
        '\n\nAFTER:\n' + crop(proposed);
    }
  };
}
