import { id } from './paths';
import type { UserArtifact } from './types';

export const MAX_ARTIFACTS = 80;
export const MAX_ARTIFACT_TEXT = 120_000;

export function artifactFormat(path: string): UserArtifact['format'] {
  const extension = path.toLowerCase().split('.').pop();
  if (extension === 'html' || extension === 'htm') return 'html';
  if (extension === 'svg') return 'svg';
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  return 'code';
}

export function saveArtifact(
  current: UserArtifact[], payload: {
    title: string; content: string; path?: string; projectId?: string | null;
  }, now = Date.now()
): UserArtifact[] {
  if (typeof payload.content !== 'string' || payload.content.length > MAX_ARTIFACT_TEXT) {
    throw new Error('Artefak terlalu besar (batas 120.000 karakter).');
  }
  const title = payload.title.trim().slice(0, 90);
  if (!title) throw new Error('Judul artefak wajib diisi.');
  const projectId = payload.projectId || null;
  const path = payload.path || '';
  const index = path ? current.findIndex(item => item.projectId === projectId && item.path === path) : -1;
  const previous = index >= 0 ? current[index] : undefined;
  const next: UserArtifact = {
    id: previous?.id || id('artifact'),
    title,
    content: payload.content,
    projectId,
    path,
    format: artifactFormat(path || title),
    createdAt: previous?.createdAt || now,
    updatedAt: now
  };
  return [next, ...current.filter(item => item.id !== previous?.id)].slice(0, MAX_ARTIFACTS);
}

export function fencedCode(text: string): { content: string; extension: string } | null {
  const match = /\x60\x60\x60([a-zA-Z0-9+#.-]*)[^\n]*\n([\s\S]*?)\n?\x60\x60\x60/.exec(text);
  if (!match) return null;
  const language = (match[1] || 'txt').toLowerCase();
  const extension = ({ javascript: 'js', typescript: 'ts', jsx: 'jsx', tsx: 'tsx', html: 'html',
    css: 'css', markdown: 'md', json: 'json', python: 'py', svg: 'svg' } as Record<string,string>)[language] || language.replace(/[^a-z0-9]/g, '') || 'txt';
  if (match[2].length > MAX_ARTIFACT_TEXT) return null;
  return { content: match[2], extension };
}

/** Only self-contained HTML/CSS/JS is executed. No network, file or host bridge is exposed. */
export function isolatedPreviewHtml(html: string): string {
  const csp = "default-src 'none'; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; media-src data:; form-action 'none'; base-uri 'none'; frame-src 'none'";
  // Prefixing the document installs CSP even when the user HTML includes its own head tag.
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
    csp.replace(/"/g, '&quot;') + '"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' +
    html + '</body></html>';
}

export function shortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
