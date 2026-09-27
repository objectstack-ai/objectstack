// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { ApiErrorSchema, makeApiErrorSchema } from './contract.zod';
import { ErrorCode, REGISTERED_ERROR_CODES } from './error-code-ledger.zod';
import { EnhancedApiErrorSchema, StandardErrorCode } from './errors.zod';

/**
 * `CONCURRENT_LIMIT_EXCEEDED` left the closed `StandardErrorCode` catalogue
 * (ADR-0049 enforce-or-remove; #17707, ruling A narrowed to this code alone).
 *
 * Each catalogue door is pinned on its own, because each builds its own `z.enum`
 * and the last two build theirs from `StandardErrorCode.options` — members
 * without the error map — so the prescription can go missing at one door while
 * the others stay green (`retired-error-codes.ts`).
 *
 * The pins assert the refusal AND its prescription: a bare `success: false`
 * would pass just as well with zod's generic enum message, which names the legal
 * codes and nothing about the branch the caller has to delete.
 */

const RETIRED = 'CONCURRENT_LIMIT_EXCEEDED';
const PRESCRIPTION =
  /`CONCURRENT_LIMIT_EXCEEDED` was removed from `StandardErrorCode`.*Delete any branch on it\..*`RATE_LIMIT_EXCEEDED`/s;

/** The message of the one issue a parse raised at `path`. */
function messageAt(result: z.ZodSafeParseResult<unknown>, path: readonly PropertyKey[]): string {
  expect(result.success).toBe(false);
  const issues = result.error!.issues.filter(
    (issue) => JSON.stringify(issue.path) === JSON.stringify(path),
  );
  expect(issues).toHaveLength(1);
  return issues[0].message;
}

const envelope = (code: string) => ({ code, message: 'm' });

describe('retired StandardErrorCode member CONCURRENT_LIMIT_EXCEEDED', () => {
  it('is no longer a catalogue member', () => {
    expect(StandardErrorCode.options).not.toContain(RETIRED);
  });

  it('door 1 — StandardErrorCode refuses it with the prescription', () => {
    expect(messageAt(StandardErrorCode.safeParse(RETIRED), [])).toMatch(PRESCRIPTION);
  });

  it('door 1 — EnhancedApiErrorSchema.code refuses it with the prescription', () => {
    expect(messageAt(EnhancedApiErrorSchema.safeParse(envelope(RETIRED)), ['code'])).toMatch(PRESCRIPTION);
  });

  it('door 2 — ErrorCode (catalogue ∪ framework ledger) refuses it with the prescription', () => {
    expect(REGISTERED_ERROR_CODES).not.toContain(RETIRED);
    expect(messageAt(ErrorCode.safeParse(RETIRED), [])).toMatch(PRESCRIPTION);
  });

  it('door 2 — ApiErrorSchema.code refuses it with the prescription', () => {
    expect(messageAt(ApiErrorSchema.safeParse(envelope(RETIRED)), ['code'])).toMatch(PRESCRIPTION);
  });

  it('door 3 — makeApiErrorSchema (catalogue ∪ a downstream ledger) refuses it with the prescription', () => {
    const DownstreamApiError = makeApiErrorSchema(['DOWNSTREAM_ONLY_CODE'] as const);
    expect(messageAt(DownstreamApiError.safeParse(envelope(RETIRED)), ['code'])).toMatch(PRESCRIPTION);
  });

  // The prescription is keyed on the exact spelling that used to be legal. A
  // typo was never a code, so telling its author it "was removed" would
  // misinform — it keeps zod's own enum message at every door.
  it('an unrelated invalid code keeps zod\'s own enum message at every door', () => {
    const typo = 'CONCURRENT_LIMIT_EXCEEDEDD';
    const messages = [
      messageAt(StandardErrorCode.safeParse(typo), []),
      messageAt(ErrorCode.safeParse(typo), []),
      messageAt(ApiErrorSchema.safeParse(envelope(typo)), ['code']),
      messageAt(makeApiErrorSchema(['DOWNSTREAM_ONLY_CODE'] as const).safeParse(envelope(typo)), ['code']),
    ];
    for (const message of messages) expect(message).not.toMatch(/was removed/);
  });

  // The ruling narrowed the retirement to this one code: its catalogue sibling
  // stays, because a hosted route emits it and a console plugin reads it.
  it('QUOTA_EXCEEDED, the sibling that stays, still parses at every door', () => {
    expect(StandardErrorCode.parse('QUOTA_EXCEEDED')).toBe('QUOTA_EXCEEDED');
    expect(ErrorCode.parse('QUOTA_EXCEEDED')).toBe('QUOTA_EXCEEDED');
    expect(EnhancedApiErrorSchema.parse(envelope('QUOTA_EXCEEDED')).code).toBe('QUOTA_EXCEEDED');
    expect(ApiErrorSchema.parse(envelope('QUOTA_EXCEEDED')).code).toBe('QUOTA_EXCEEDED');
    expect(
      makeApiErrorSchema(['DOWNSTREAM_ONLY_CODE'] as const).parse(envelope('QUOTA_EXCEEDED')).code,
    ).toBe('QUOTA_EXCEEDED');
  });
});
