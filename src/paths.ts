/** Validates paths inside the app's own project sandbox. Never allow absolute paths or traversal. */
export function safePath(input: string): string {
  if (typeof input !== 'string' || input.length < 1 || input.length > 180) {
    throw new Error('File path must contain 1–180 characters');
  }
  if (input.includes('\\') || input.startsWith('/') || input.includes('\0') ||
      /[\x00-\x1F\x7F]/.test(input) || /[:*?"<>|]/.test(input)) {
    throw new Error('Unsafe file path');
  }
  const segments = input.split('/');
  if (segments.length > 10 || segments.some(x => !x || x === '.' || x === '..' || x.length > 80)) {
    throw new Error('Unsafe file path segments');
  }
  return segments.join('/');
}

export function safeProjectName(input: string): string {
  const name = input.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 45) throw new Error('Project name must be 1–45 characters');
  return name;
}

export function id(prefix = 'id') {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}
