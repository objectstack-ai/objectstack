// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  isRateLimitError,
  isUnsentSendError,
  parseAiQuotaError,
  sendErrorStatus,
} from './tool-display';

/** Build an error shaped like one from sendAwareFetch. */
function tagged(status: number | undefined, message = 'x'): Error {
  const e = new Error(message) as Error & { status?: number; notSent?: boolean };
  e.notSent = true;
  if (status) e.status = status;
  return e;
}

describe('isUnsentSendError', () => {
  it('is true only when the error is tagged notSent', () => {
    expect(isUnsentSendError(tagged(429))).toBe(true);
    expect(isUnsentSendError(tagged(undefined))).toBe(true);
    expect(isUnsentSendError(new Error('stream dropped'))).toBe(false);
    expect(isUnsentSendError(undefined)).toBe(false);
    expect(isUnsentSendError(null)).toBe(false);
  });
});

describe('sendErrorStatus', () => {
  it('returns the tagged HTTP status when present', () => {
    expect(sendErrorStatus(tagged(429))).toBe(429);
    expect(sendErrorStatus(tagged(503))).toBe(503);
    expect(sendErrorStatus(tagged(undefined))).toBeUndefined();
    expect(sendErrorStatus(new Error('boom'))).toBeUndefined();
  });
});

describe('isRateLimitError', () => {
  it('detects a 429 via the tagged status', () => {
    expect(isRateLimitError(tagged(429))).toBe(true);
    expect(isRateLimitError(tagged(503))).toBe(false);
  });
  it('falls back to a message probe when the status was dropped', () => {
    expect(isRateLimitError(new Error('429 Too Many Requests'))).toBe(true);
    expect(isRateLimitError(new Error('rate limit exceeded'))).toBe(true);
    expect(isRateLimitError(new Error('rate_limited'))).toBe(true);
    expect(isRateLimitError(new Error('internal server error'))).toBe(false);
  });
});

describe('parseAiQuotaError', () => {
  const body = (extra: Record<string, unknown>) =>
    JSON.stringify({ message: 'quota', messageEn: 'Quota used up', ...extra });

  it('recognizes the free design quota refusal', () => {
    const r = parseAiQuotaError(new Error(body({ error: 'ai_design_quota_exhausted', upgrade: true })));
    expect(r).toMatchObject({ code: 'ai_design_quota_exhausted', upgrade: true, topUp: false });
  });

  it('recognizes the free data-chat trial refusal', () => {
    const r = parseAiQuotaError(new Error(body({ error: 'ai_data_chat_trial_exhausted', upgrade: true })));
    expect(r?.code).toBe('ai_data_chat_trial_exhausted');
  });

  it('recognizes the paid allowance refusal with topUp', () => {
    const r = parseAiQuotaError(new Error(body({ error: 'ai_allowance_exhausted', upgrade: false, topUp: true })));
    expect(r).toMatchObject({ code: 'ai_allowance_exhausted', upgrade: false, topUp: true });
    expect(r?.messageEn).toBe('Quota used up');
  });

  it('strips the ai-sdk "Failed after N attempts" retry prefix', () => {
    const r = parseAiQuotaError(
      new Error(`Failed after 2 attempts. Last error: ${body({ error: 'ai_allowance_exhausted' })}`),
    );
    expect(r?.code).toBe('ai_allowance_exhausted');
  });

  it('returns null for unrelated errors', () => {
    expect(parseAiQuotaError(new Error('network timeout'))).toBeNull();
    expect(parseAiQuotaError(new Error(JSON.stringify({ error: 'something_else' })))).toBeNull();
    expect(parseAiQuotaError(undefined)).toBeNull();
    expect(parseAiQuotaError('')).toBeNull();
  });

  // The FOUR-dialect matrix (objectui#3491 / cloud#944, widened by
  // objectui#3804). The two live producers fill `error` in opposite ways,
  // ADR-0112 declares the envelope shape, and cloud#1168 -> cloud PR #1238
  // landed the fourth: that envelope carrying the SCREAMING_SNAKE ledger
  // vocabulary with the companions inside `error.details`. Every one of them
  // must be readable HERE, and every one must miss on a non-quota code.
  //
  // ⚠️ DEGENERATE-CONTROL NOTE. This file already exercised the lowercase trio
  // heavily, so a lowercase-only case proves nothing about this change: it
  // passes against the unfixed code too. The assertions that actually pin the
  // NEW behavior are exactly (a) everything driven by `LEDGER_CODES`, and
  // (b) the `declared envelope + ledger vocabulary` describe below, including
  // its `error.details` companion reads (which fail on the old code even with
  // a lowercase code, because `error.details` was not read at all).
  describe('dialect matrix', () => {
    const err = (payload: unknown) => new Error(JSON.stringify(payload));
    // Legacy vocabulary — transition-period producers still emit it.
    const CODES = [
      'ai_design_quota_exhausted',
      'ai_data_chat_trial_exhausted',
      'ai_allowance_exhausted',
    ] as const;
    // Ledger vocabulary landed by cloud PR #1238. NEW-BEHAVIOR assertions.
    const LEDGER_CODES = [
      'AI_DESIGN_QUOTA_EXHAUSTED',
      'AI_DATA_CHAT_TRIAL_EXHAUSTED',
      'AI_ALLOWANCE_EXHAUSTED',
    ] as const;

    describe('flat guardrail dialect — `error` holds the code', () => {
      it.each(CODES)('hits on %s', (code) => {
        expect(parseAiQuotaError(err({ error: code, message: 'zh', upgrade: true }))).toMatchObject({
          code,
          message: 'zh',
          upgrade: true,
        });
      });

      // NEW BEHAVIOR: the guardrail's flat limb now speaks the ledger
      // vocabulary too, so a producer that converged its CODE before its SHAPE
      // is still parsed.
      it.each(LEDGER_CODES)('hits on the ledger code %s', (code) => {
        expect(parseAiQuotaError(err({ error: code, message: 'zh', upgrade: true }))).toMatchObject({
          code,
          message: 'zh',
          upgrade: true,
        });
      });

      it('misses on a code outside the recognized set', () => {
        expect(parseAiQuotaError(err({ error: 'ai_quota_exhausted', message: 'zh' }))).toBeNull();
      });
    });

    describe('service-ai dialect — code in the `code` sibling key', () => {
      it.each(CODES)('hits on %s', (code) => {
        expect(
          parseAiQuotaError(err({ error: '', code, resetAt: '2026-08-09T00:00:00Z' })),
        ).toMatchObject({ code, message: '' });
      });

      it('reads the prose this dialect puts in `error` as the message', () => {
        // `error` carries the message here, so it must surface as the message —
        // and, in the flat dialect above, must NOT (it is the code there).
        const prose = 'AI allowance exhausted, retry after the reset.';
        expect(
          parseAiQuotaError(err({ error: prose, code: 'ai_allowance_exhausted' })),
        ).toMatchObject({ code: 'ai_allowance_exhausted', message: prose });
      });

      // NEW BEHAVIOR: same limb, ledger vocabulary.
      it.each(LEDGER_CODES)('hits on the ledger code %s', (code) => {
        expect(
          parseAiQuotaError(err({ error: '', code, resetAt: '2026-08-09T00:00:00Z' })),
        ).toMatchObject({ code, message: '' });
      });

      it('misses on the code service-ai emits today, which is not in the set', () => {
        // Documents a real remaining gap rather than asserting it away. Still
        // a gap after cloud#1238: `ai_quota_exhausted` is in NEITHER vocabulary
        // — not the legacy trio, not the ledger trio.
        expect(
          parseAiQuotaError(err({ error: '', code: 'ai_quota_exhausted', resetAt: 'x' })),
        ).toBeNull();
      });
    });

    describe('declared envelope (ADR-0112) — code nested under `error`', () => {
      it.each(CODES)('hits on %s', (code) => {
        expect(
          parseAiQuotaError(err({ success: false, error: { code, message: 'zh' } })),
        ).toMatchObject({ code, message: 'zh' });
      });

      // NEW BEHAVIOR: the envelope now carries the ledger vocabulary, which is
      // the only vocabulary a spec-conformant `error.code` may use.
      it.each(LEDGER_CODES)('hits on the ledger code %s', (code) => {
        expect(
          parseAiQuotaError(err({ success: false, error: { code, message: 'zh' } })),
        ).toMatchObject({ code, message: 'zh' });
      });

      it('misses on a declared non-quota code', () => {
        expect(
          parseAiQuotaError(
            err({ success: false, error: { code: 'QUOTA_EXCEEDED', message: 'zh' } }),
          ),
        ).toBeNull();
      });

      it('misses when the nested error carries no code at all', () => {
        expect(parseAiQuotaError(err({ success: false, error: { message: 'zh' } }))).toBeNull();
      });
    });

    // ---- THE FOURTH DIALECT (objectui#3804) --------------------------------
    // What cloud PR #1238 actually shipped: the declared envelope, the ledger
    // vocabulary, and the companion fields nested inside `error.details`.
    // EVERY assertion in this describe is a new-behavior assertion — the old
    // code never read `error.details` at all, so even the lowercase-code case
    // here fails against origin/main.
    describe('declared envelope + ledger vocabulary — companions in `error.details`', () => {
      const landed = (code: string) => ({
        success: false,
        error: {
          code,
          message: 'zh',
          details: {
            messageEn: 'Your AI allowance is used up.',
            upgrade: false,
            topUp: true,
            resetsTonight: true,
          },
        },
      });

      it.each(LEDGER_CODES)('reads %s with its nested companion fields', (code) => {
        expect(parseAiQuotaError(err(landed(code)))).toEqual({
          code,
          message: 'zh',
          messageEn: 'Your AI allowance is used up.',
          upgrade: false,
          topUp: true,
          resetsTonight: true,
        });
      });

      it('prefers the declared `error.details` companions over the legacy top-level ones', () => {
        // The realistic transitional producer double-emits. The declared
        // position wins, matching the total order the code lookup already uses.
        expect(
          parseAiQuotaError(
            err({
              success: false,
              error: {
                code: 'AI_ALLOWANCE_EXHAUSTED',
                message: 'zh',
                details: { messageEn: 'nested', upgrade: true, topUp: false },
              },
              messageEn: 'top-level',
              upgrade: false,
              topUp: true,
            }),
          ),
        ).toMatchObject({
          messageEn: 'nested',
          upgrade: true,
          topUp: false,
        });
      });

      it('falls back to the top-level companions when the envelope carries no details', () => {
        // The legacy limb stays reachable — this is the shape a producer that
        // moved its CODE but not its COMPANIONS emits.
        expect(
          parseAiQuotaError(
            err({
              success: false,
              error: { code: 'AI_DESIGN_QUOTA_EXHAUSTED', message: 'zh' },
              messageEn: 'top-level',
              upgrade: true,
            }),
          ),
        ).toMatchObject({
          code: 'AI_DESIGN_QUOTA_EXHAUSTED',
          messageEn: 'top-level',
          upgrade: true,
          topUp: false,
        });
      });

      it('leaves resetsTonight undefined unless a producer sends an actual boolean', () => {
        // The POSITION of this field is measured (cloud#1238 puts it in
        // `error.details`); its TYPE is not pinned by anything we can read from
        // this repo. So a non-boolean is dropped rather than coerced into a
        // `false` no producer declared.
        const r = parseAiQuotaError(
          err({
            success: false,
            error: {
              code: 'AI_ALLOWANCE_EXHAUSTED',
              details: { resetsTonight: '2026-08-26T00:00:00Z' },
            },
          }),
        );
        expect(r?.resetsTonight).toBeUndefined();
        expect(
          parseAiQuotaError(
            err({
              success: false,
              error: { code: 'AI_ALLOWANCE_EXHAUSTED', details: { resetsTonight: false } },
            }),
          )?.resetsTonight,
        ).toBe(false);
      });

      // objectui#7587 — the free plan's shape AFTER cloud PR #1852 (the rolling
      // 7-day window): same field, same type, inverted VALUE, plus a sibling
      // key the parser has no read for. The pin above is about the type and
      // stays true; this one is about what the parse hands downstream, which is
      // where the change actually landed.
      it('parses the free-plan envelope and carries no reset instant out of it', () => {
        const parsed = parseAiQuotaError(
          err({
            success: false,
            error: {
              code: 'AI_ALLOWANCE_EXHAUSTED',
              message: 'zh',
              details: {
                messageEn: 'Your free AI allowance is used up.',
                upgrade: true,
                topUp: false,
                resetsTonight: false,
                resetsAt: '2026-09-13T00:00:00Z',
              },
            },
          }),
        );
        // The whole shape, so an added field is a deliberate edit to this line.
        expect(parsed).toEqual({
          code: 'AI_ALLOWANCE_EXHAUSTED',
          message: 'zh',
          messageEn: 'Your free AI allowance is used up.',
          upgrade: true,
          topUp: false,
          resetsTonight: false,
        });
        // Stated separately because `toEqual` treats an explicit `undefined`
        // property as absent: the KEY is not on the parsed object at all, so no
        // consumer downstream can render the instant the producer sent. Reading
        // it is a real option (objectui#7587 weighs it) — it just needs a
        // reader and a measured wire position, and this line is where that
        // decision has to be made out loud.
        expect(parsed && 'resetsAt' in parsed).toBe(false);
      });

      it('ignores a non-object `details` instead of throwing', () => {
        expect(
          parseAiQuotaError(
            err({ success: false, error: { code: 'AI_ALLOWANCE_EXHAUSTED', details: [1, 2] } }),
          ),
        ).toMatchObject({ code: 'AI_ALLOWANCE_EXHAUSTED', upgrade: false, topUp: false });
        expect(
          parseAiQuotaError(
            err({ success: false, error: { code: 'AI_ALLOWANCE_EXHAUSTED', details: 'nope' } }),
          ),
        ).toMatchObject({ code: 'AI_ALLOWANCE_EXHAUSTED', upgrade: false, topUp: false });
      });
    });

    // ---- THE VOCABULARY THAT STAYS GENERIC (objectui#3804) -----------------
    // cloud PR #1238 deliberately left `POST /api/v1/ai/agents/:name/chat`'s
    // per-turn message cap on the standard `QUOTA_EXCEEDED`: it has no upgrade
    // / top-up / trial next step, which is the exact distinction the 2026-08-11
    // Option A ruling drew when admitting the three `AI_*` codes to the ledger.
    //
    // ⚠️ These assertions PASS against origin/main as well — they are
    // regression pins for behavior this PR PRESERVES, not new-behavior
    // assertions. They exist because the cross-seat relay asked for a pin that
    // per-turn 429s keep being handled, and this is where that handling lives.
    describe('generic QUOTA_EXCEEDED (per-turn cap) keeps the rate-limit path', () => {
      const perTurn = {
        success: false,
        error: {
          code: 'QUOTA_EXCEEDED',
          message: 'zh',
          category: 'rate_limit',
          details: { resetAt: '2026-08-26T00:00:00Z' },
        },
      };

      it('is not a quota-CTA refusal, so no upgrade / top-up CTA is offered', () => {
        // Recognizing it here would render ErrorBanner's "Upgrade needed" +
        // "Upgrade plan" to a user whose cap resets in a minute.
        expect(parseAiQuotaError(err(perTurn))).toBeNull();
      });

      it('routes to the unsent rate-limit notice instead', () => {
        // ChatbotEnhanced renders SendErrorNotice (with the "you're sending
        // too quickly" copy and the typed text restored) exactly when
        // `isUnsentSendError(e) && !parseAiQuotaError(e)`.
        const e = tagged(429, JSON.stringify(perTurn));
        expect(isUnsentSendError(e)).toBe(true);
        expect(isRateLimitError(e)).toBe(true);
        expect(isUnsentSendError(e) && !parseAiQuotaError(e)).toBe(true);
      });

      it('a non-quota 429 still falls through to the generic path', () => {
        const e = tagged(
          429,
          JSON.stringify({
            success: false,
            error: { code: 'RATE_LIMIT_EXCEEDED', message: 'zh' },
          }),
        );
        expect(parseAiQuotaError(e)).toBeNull();
        expect(isUnsentSendError(e) && !parseAiQuotaError(e)).toBe(true);
      });
    });

    it('degrades to today’s behavior (null) for unknown shapes', () => {
      expect(parseAiQuotaError(err({ success: false, error: null }))).toBeNull();
      expect(parseAiQuotaError(err({ success: false, error: [] }))).toBeNull();
      expect(parseAiQuotaError(err({ error: { code: 42 } }))).toBeNull();
      expect(parseAiQuotaError(err({ code: 42 }))).toBeNull();
      expect(parseAiQuotaError(new Error('{ not json }'))).toBeNull();
    });

    it('still locates a quota body embedded in surrounding text', () => {
      // Unchanged pre-existing behavior, pinned because the dialect widening
      // reads more keys off whatever this substring extraction returns: the body
      // is sliced from the first `{` to the last `}`, so a wrapper (prose, or a
      // JSON array of one error) does not hide it.
      expect(
        parseAiQuotaError(new Error('POST /api/chat 429: {"error":"ai_allowance_exhausted"}')),
      ).toMatchObject({ code: 'ai_allowance_exhausted' });
      expect(
        parseAiQuotaError(err([{ success: false, error: { code: 'ai_allowance_exhausted' } }])),
      ).toMatchObject({ code: 'ai_allowance_exhausted' });
    });

    describe('companion fields stay backward compatible', () => {
      it('reads top-level upgrade / topUp / messageEn alongside a nested code', () => {
        // The realistic transitional producer: declared envelope emitted next to
        // the legacy top-level keys old clients still read.
        expect(
          parseAiQuotaError(
            err({
              success: false,
              error: { code: 'ai_allowance_exhausted', message: 'zh' },
              messageEn: 'Allowance used up',
              upgrade: false,
              topUp: true,
            }),
          ),
        ).toMatchObject({
          code: 'ai_allowance_exhausted',
          message: 'zh',
          messageEn: 'Allowance used up',
          upgrade: false,
          topUp: true,
        });
      });

      it('defaults the CTA flags to false when a payload carries none', () => {
        // A nested-only payload gets no CTA flags: their position in the declared
        // envelope is deliberately not presumed (cloud#1168 aligns it).
        expect(
          parseAiQuotaError(err({ success: false, error: { code: 'ai_allowance_exhausted' } })),
        ).toEqual({
          code: 'ai_allowance_exhausted',
          message: '',
          messageEn: undefined,
          upgrade: false,
          topUp: false,
        });
      });
    });

    describe('parse priority is a total order', () => {
      it('prefers the declared envelope over the legacy limbs', () => {
        expect(
          parseAiQuotaError(
            err({
              success: false,
              error: { code: 'ai_design_quota_exhausted', message: 'nested' },
              code: 'ai_allowance_exhausted',
              message: 'flat',
            }),
          ),
        ).toMatchObject({ code: 'ai_design_quota_exhausted', message: 'nested' });
      });

      it('prefers the flat code over the sibling code key', () => {
        expect(
          parseAiQuotaError(
            err({ error: 'ai_design_quota_exhausted', code: 'ai_allowance_exhausted' }),
          ),
        ).toMatchObject({ code: 'ai_design_quota_exhausted' });
      });

      it('falls through to a legacy limb when the nested code is unrecognized', () => {
        expect(
          parseAiQuotaError(
            err({
              success: false,
              error: { code: 'QUOTA_EXCEEDED', message: 'nested' },
              code: 'ai_allowance_exhausted',
              message: 'flat',
            }),
          ),
        ).toMatchObject({ code: 'ai_allowance_exhausted', message: 'nested' });
      });
    });
  });
});
