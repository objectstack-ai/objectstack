/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack-ai/objectstack#37081 — a flat refusal body's bare-string `error`
 * is a machine code; when the body also carries a `message`, the user reads
 * the message.
 *
 * The body below is the REST seam's flat 401, `ANONYMOUS_DENY_BODY` in
 * `packages/core/src/security/anonymous-deny.ts`, copied field for field:
 * `@object-ui/core` does not depend on `@objectstack/core`.
 */

import { describe, it, expect } from 'vitest';
import { actionErrorDetail } from '../actionErrorDetail';

const ANONYMOUS_DENY_BODY = {
  error: 'UNAUTHENTICATED',
  code: 'UNAUTHENTICATED',
  message: 'Authentication is required to access this endpoint.',
};

describe('actionErrorDetail — message before a bare-string error code', () => {
  it('returns the flat 401 body\'s message, not its code', () => {
    expect(actionErrorDetail(ANONYMOUS_DENY_BODY, 'HTTP 401')).toBe(
      'Authentication is required to access this endpoint.',
    );
  });

  it('still returns a bare-string error when the body has no message', () => {
    expect(actionErrorDetail({ error: 'Record is locked' }, 'fallback')).toBe('Record is locked');
  });

  it('returns the bare-string error when the message is empty or not a string', () => {
    expect(actionErrorDetail({ error: 'Record is locked', message: '' }, 'fallback')).toBe('Record is locked');
    expect(actionErrorDetail({ error: 'Record is locked', message: 42 }, 'fallback')).toBe('Record is locked');
  });

  it('reads the nested envelope message as before, ahead of a top-level message', () => {
    expect(
      actionErrorDetail({ error: { code: 'PERMISSION_DENIED', message: 'Nested sentence' } }, 'fallback'),
    ).toBe('Nested sentence');
    expect(
      actionErrorDetail(
        { error: { code: 'PERMISSION_DENIED', message: 'Nested sentence' }, message: 'Top sentence' },
        'fallback',
      ),
    ).toBe('Nested sentence');
  });

  it('reads a lone top-level message, and falls back when nothing is readable', () => {
    expect(actionErrorDetail({ message: 'Top sentence' }, 'fallback')).toBe('Top sentence');
    expect(actionErrorDetail({ error: '', message: '' }, 'fallback')).toBe('fallback');
    expect(actionErrorDetail({}, 'fallback')).toBe('fallback');
    expect(actionErrorDetail(null, 'fallback')).toBe('fallback');
  });
});
