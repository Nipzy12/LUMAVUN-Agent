import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safePath, safeProjectName } from '../src/paths';

test('accept nested relative text-file paths', () => {
  assert.equal(safePath('src/components/Button.tsx'), 'src/components/Button.tsx');
  assert.equal(safeProjectName('  Hello   World '), 'Hello World');
});
test('block traversal, absolute paths, unsafe path components', () => {
  for (const path of ['../secret', '/etc/passwd', 'src/../secret', 'C:\\Windows\\x', 'x//y', 'src/./a', 'a:b', '']) {
    assert.throws(() => safePath(path), path);
  }
});
