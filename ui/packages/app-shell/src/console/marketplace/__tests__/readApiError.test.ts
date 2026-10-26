/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `readApiError` — every failure dialect `service-cloud` answers in (cloud#944).
 *
 * These routes are mid-conversion. `fail()` / `failWithCode()` emit
 * `{ success: false, error: '<message>' }` today; the declared envelope nests it
 * as `{ code, message }`. Both must read the same here, so the server side can
 * convert on its own schedule instead of landing in lockstep with a console
 * release — the same reason `useAgents` learned four shapes before the /ai/agents
 * producers moved (objectui#2992, objectstack#4053).
 *
 * Why a test rather than a comment: the failure is not a parse error. Two call
 * sites in `marketplaceApi.ts` read `payload?.error` bare, so a converted
 * producer hands them an OBJECT where the surrounding type declares
 * `error?: string`. That object reaches `toast.error()` as a React child and
 * crashes the page — objectstack#3913's exact symptom, which the actions route
 * already carries `interpretActionResponse` to prevent. Nothing about the types
 * catches it: the payloads are `any`.
 */

import { describe, expect, it } from 'vitest';
import { readApiError } from '../marketplaceApi';

const res = (status = 400, statusText = 'Bad Request') => ({ status, statusText });

describe('readApiError — both dialects read the same', () => {
  it('reads the declared envelope', () => {
    expect(readApiError(
      { success: false, error: { code: 'ENV_NOT_FOUND', message: 'Environment not found' } },
      res(404, 'Not Found'),
    )).toEqual({ code: 'ENV_NOT_FOUND', message: 'Environment not found' });
  });

  it("reads `fail()`'s bare string — what these routes send today", () => {
    expect(readApiError(
      { success: false, error: 'environment_id is required' },
      res(),
    )).toEqual({ code: 'HTTP_400', message: 'environment_id is required' });
  });

  it('agrees on the message across both — the point of one reader', () => {
    const nested = readApiError({ error: { code: 'X', message: 'same text' } }, res());
    const bare = readApiError({ error: 'same text' }, res());
    expect(nested.message).toBe(bare.message);
  });

  it("reads `failWithCode()`'s sibling `code`", () => {
    // `{ success: false, error: '<message>', code }` — the third dialect, where
    // the code sits BESIDE `error` rather than inside it.
    expect(readApiError(
      { success: false, error: 'Slug rename in progress', code: 'SLUG_RENAME_IN_PROGRESS' },
      res(503, 'Service Unavailable'),
    )).toEqual({ code: 'SLUG_RENAME_IN_PROGRESS', message: 'Slug rename in progress' });
  });

  it('prefers the nested code over a sibling one when both are present', () => {
    expect(readApiError({ error: { code: 'INNER', message: 'm' }, code: 'OUTER' }, res()).code)
      .toBe('INNER');
  });
});

describe('readApiError — never hands back a non-string message', () => {
  it('degrades an unexpected `error` shape to the code rather than passing the object on', () => {
    // The whole reason this returns a string: an object travelling onward as
    // `ActionResult.error` reaches a toast as a React child and crashes the page.
    const out = readApiError({ error: { unexpected: true } }, res(500, 'Server Error'));
    expect(typeof out.message).toBe('string');
    expect(out.message).toBe('HTTP_500');
  });

  it('falls back to statusText when there is no body at all', () => {
    expect(readApiError(null, res(502, 'Bad Gateway')))
      .toEqual({ code: 'HTTP_502', message: 'Bad Gateway' });
    expect(readApiError({}, res(502, 'Bad Gateway')))
      .toEqual({ code: 'HTTP_502', message: 'Bad Gateway' });
  });

  it('reads a top-level `message` — a few routes put the text there', () => {
    expect(readApiError({ message: 'quota exceeded' }, res(429, 'Too Many Requests')).message)
      .toBe('quota exceeded');
  });
});
