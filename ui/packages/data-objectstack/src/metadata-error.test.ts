// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// Moved here from `app-shell`'s `views/studio-design/metadataError.test.ts`
// with the reader itself (objectui#11302); the cases are unchanged.

import { describe, it, expect } from 'vitest';
import { extractIssues, formatMetadataError, formatMetadataIssue } from './metadata-error';

describe('formatMetadataError', () => {
  it('lists field-anchored issues, one per line, when the error carries them', () => {
    const err = Object.assign(new Error('[invalid_metadata] object/bad failed spec validation: ...'), {
      issues: [
        { path: 'fields.amount.type', message: 'Required' },
        { path: 'label', message: 'Required' },
      ],
    });
    expect(formatMetadataError(err)).toBe(
      '• fields.amount.type — Required\n• label — Required',
    );
  });

  it('labels a root-level issue (empty path) as (root)', () => {
    const err = Object.assign(new Error('bad'), { issues: [{ path: '', message: 'Must have a name' }] });
    expect(formatMetadataError(err)).toBe('• (root) — Must have a name');
  });

  it('falls back to the plain message when there are no issues', () => {
    expect(formatMetadataError(new Error('Save failed: network'))).toBe('Save failed: network');
  });

  it('stringifies a non-Error throw', () => {
    expect(formatMetadataError('boom')).toBe('boom');
  });
});

describe('formatMetadataIssue', () => {
  it('is the line grammar formatMetadataError lists', () => {
    const issue = { path: 'fields.amount.type', message: 'Required' };
    expect(formatMetadataIssue(issue)).toBe('• fields.amount.type — Required');
    expect(formatMetadataError(Object.assign(new Error('x'), { issues: [issue] }))).toBe(
      formatMetadataIssue(issue),
    );
  });
});

describe('extractIssues', () => {
  it('returns the issues array, or empty for none / non-arrays', () => {
    expect(extractIssues({ issues: [{ path: 'a', message: 'b' }] })).toHaveLength(1);
    expect(extractIssues(new Error('x'))).toEqual([]);
    expect(extractIssues({ issues: 'nope' })).toEqual([]);
    expect(extractIssues(null)).toEqual([]);
  });
});
