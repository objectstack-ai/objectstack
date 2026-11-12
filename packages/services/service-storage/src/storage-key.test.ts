// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { buildKey, storageKeyExtension } from './storage-key.js';

// A key is `<scope>/<fileId><.ext>`: exactly one `/`, and the client's file
// name reaches only the extension, taken from a sanitised basename.
describe('buildKey: a client file name never adds a path segment to the key', () => {
  it.each<[string, string, string]>([
    ['a traversal name', '../../etc/passwd', ''],
    ['a nested POSIX path', 'a/b/c.png', '.png'],
    ['a nested Windows path', 'a\\b\\c.png', '.png'],
    ['a Windows absolute path', 'C:\\Users\\x\\report.pdf', '.pdf'],
    ['a separator after the last dot', 'evil.p/ng', ''],
    ['a backslash after the last dot', 'evil.p\\ng', ''],
    ['a traversal ending in a dot run', 'x.png/../..', ''],
  ])('%s (%j) keys as fid%j', (_label, filename, ext) => {
    const key = buildKey('user', 'fid', filename);
    expect(key).toBe(`user/fid${ext}`);
    expect(key.split('/'), 'scope and file id, nothing else').toHaveLength(2);
    expect(key).not.toContain('\\');
  });

  it('CONTROL: a plain name keeps its extension, case as sent', () => {
    expect(buildKey('attachments', 'fid', 'photo.JPG')).toBe('attachments/fid.JPG');
    expect(buildKey('user', 'fid', 'archive.tar.gz')).toBe('user/fid.gz');
    expect(buildKey('user', 'fid', 'README')).toBe('user/fid');
  });
});

describe('storageKeyExtension: the extension is a short run of ASCII letters and digits, or nothing', () => {
  it.each<[string, string]>([
    ['trailing dot', 'file.'],
    ['space in the extension', 'file.p ng'],
    ['control character', 'file.p\u0000ng'],
    ['non-ASCII extension', 'file.文档'],
    ['punctuation', 'file.png;rm'],
    ['seventeen characters', `file.${'a'.repeat(17)}`],
    ['dot only', '.'],
    ['dot-dot', '..'],
    ['empty', ''],
  ])('%s: no extension', (_label, filename) => {
    expect(storageKeyExtension(filename)).toBe('');
  });

  it('CONTROL: sixteen characters is the bound', () => {
    expect(storageKeyExtension(`file.${'a'.repeat(16)}`)).toBe(`.${'a'.repeat(16)}`);
  });
});
