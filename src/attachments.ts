import { File } from 'expo-file-system';
import type { ImagePickerAsset } from 'expo-image-picker';
import type { DocumentPickerAsset } from 'expo-document-picker';
import type { APIMessage } from './provider';

export type PendingAttachment = {
  id: string; name: string; kind: 'image' | 'text'; uri: string;
  mime: string; content: string;
};
const imageMax = 5 * 1024 * 1024;
const textMax = 160 * 1024;
const textExt = /\.(txt|md|json|jsonl|csv|ts|tsx|js|jsx|py|html|css|xml|yml|yaml|log|sql)$/i;
export function isTextAttachment(name: string, mime: string) {
  return textExt.test(name) || /^text\//i.test(mime) ||
    ['application/json', 'application/javascript', 'application/xml'].includes(mime);
}
export async function fromImage(asset: ImagePickerAsset): Promise<PendingAttachment> {
  if (asset.fileSize && asset.fileSize > imageMax) throw new Error('Gambar maksimal 5 MB.');
  const file = new File(asset.uri);
  if (file.size && file.size > imageMax) throw new Error('Gambar maksimal 5 MB.');
  const content = asset.base64 || await file.base64();
  return { id: String(Date.now()) + '-' + Math.random().toString(36).slice(2), name: asset.fileName || 'photo.jpg',
    kind: 'image', uri: asset.uri, mime: asset.base64 ? 'image/jpeg' : (asset.mimeType || 'image/jpeg'), content };
}
export async function fromDocument(asset: DocumentPickerAsset): Promise<PendingAttachment> {
  const mime = asset.mimeType || '';
  if (!isTextAttachment(asset.name, mime)) {
    throw new Error('File ini belum didukung. Gunakan teks, Markdown, CSV, kode atau JSON; PDF/biner membutuhkan parser khusus.');
  }
  if (asset.size && asset.size > textMax) throw new Error('Dokumen teks maksimal 160 KB.');
  const file = new File(asset.uri);
  if (file.size && file.size > textMax) throw new Error('Dokumen teks maksimal 160 KB.');
  return { id: String(Date.now()) + '-' + Math.random().toString(36).slice(2), name: asset.name,
    kind: 'text', uri: asset.uri, mime: mime || 'text/plain', content: (await file.text()).slice(0, textMax) };
}
export function buildAttachmentInput(prompt: string, attachments: PendingAttachment[]): APIMessage['content'] {
  const text = [prompt.trim(), ...attachments.filter(a => a.kind === 'text')
    .map(a => 'Attached document ' + a.name + ':\n```\n' + a.content + '\n```')]
    .filter(Boolean).join('\n\n');
  const images = attachments.filter(a => a.kind === 'image');
  if (!images.length) return text;
  return [
    { type: 'text', text: text || 'Describe the attached images.' },
    ...images.map(a => ({ type: 'image_url' as const, image_url: { url: 'data:' + a.mime + ';base64,' + a.content } }))
  ];
}
