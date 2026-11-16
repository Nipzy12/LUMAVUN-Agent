import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artifactFormat, fencedCode, isolatedPreviewHtml, saveArtifact, MAX_ARTIFACTS } from '../src/artifacts';

test('saved artifacts are private snapshots, updated in place for the same source file', () => {
  const a = saveArtifact([], { title: 'index.html', projectId: 'project-sample', path: 'index.html', content: '<h1>A</h1>' }, 10);
  assert.equal(a.length, 1);
  assert.equal(a[0].format, 'html');
  const b = saveArtifact(a, { title: 'index.html', projectId: 'project-sample', path: 'index.html', content: '<h1>B</h1>' }, 20);
  assert.equal(b.length, 1);
  assert.equal(b[0].id, a[0].id);
  assert.equal(b[0].createdAt, 10);
  assert.equal(b[0].updatedAt, 20);
  assert.equal(b[0].content, '<h1>B</h1>');
});

test('different projects may have files with the same name', () => {
  const a = saveArtifact([], { title: 'main.ts', path: 'main.ts', projectId: 'project-1', content: 'A' }, 10);
  const b = saveArtifact(a, { title: 'main.ts', path: 'main.ts', projectId: 'project-2', content: 'B' }, 20);
  assert.equal(b.length, 2);
  assert.notEqual(b[0].id, b[1].id);
});

test('extract fenced code from assistant messages for manual artifact save', () => {
  const snippet = fencedCode('Ini contoh\n' + '\x60\x60\x60html\n<h1>Halo</h1>\n\x60\x60\x60');
  assert.deepEqual(snippet, { content: '<h1>Halo</h1>', extension: 'html' });
  assert.equal(fencedCode('no source code here'), null);
});

test('local HTML preview blocks remote connections and file subresources by CSP', () => {
  const html = isolatedPreviewHtml('<h1>Hello</h1><script>document.body.dataset.ok=1</script>');
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /frame-src 'none'/);
  assert.ok(html.includes('<h1>Hello</h1>'));
  assert.ok(html.includes("script-src 'unsafe-inline'"));
});

test('artifact validation and gallery bounds', () => {
  assert.equal(artifactFormat('demo.html'), 'html');
  assert.equal(artifactFormat('screen.tsx'), 'code');
  assert.throws(() => saveArtifact([], { title: 'x', content: 'a'.repeat(120001) }));
  let gallery = [] as ReturnType<typeof saveArtifact>;
  for (let i=0; i<85; i++) gallery = saveArtifact(gallery, {
    title: 'Script ' + i, path: 'file' + i + '.html', projectId: 'project-1', content: 'ok'
  }, i + 1);
  assert.equal(gallery.length, MAX_ARTIFACTS);
});
