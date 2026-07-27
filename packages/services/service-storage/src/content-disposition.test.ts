// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { contentDispositionValue } from './content-disposition.js';

describe('contentDispositionValue', () => {
  it('defaults to inline and emits both filename and filename*', () => {
    expect(contentDispositionValue('signed-contract.pdf')).toBe(
      "inline; filename=\"signed-contract.pdf\"; filename*=UTF-8''signed-contract.pdf",
    );
  });

  it('honors an attachment disposition', () => {
    expect(contentDispositionValue('report.csv', 'attachment')).toBe(
      "attachment; filename=\"report.csv\"; filename*=UTF-8''report.csv",
    );
  });

  it('keeps a non-ASCII name in filename* and sanitizes the ASCII fallback', () => {
    const v = contentDispositionValue('季度报告.pdf');
    // ASCII fallback replaces each of the 4 non-ascii chars; filename* preserves them.
    expect(v).toContain('filename="____.pdf"');
    expect(v).toContain("filename*=UTF-8''%E5%AD%A3%E5%BA%A6%E6%8A%A5%E5%91%8A.pdf");
  });

  it('neutralizes quotes/backslashes in the ASCII fallback (no header injection)', () => {
    const v = contentDispositionValue('a"b\\c.txt');
    expect(v).toContain('filename="a_b_c.txt"');
  });
});
