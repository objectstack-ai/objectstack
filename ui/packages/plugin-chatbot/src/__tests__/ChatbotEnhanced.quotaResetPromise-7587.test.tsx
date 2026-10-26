/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#7587 — what a free-plan 429 actually puts on screen, now that the
 * producer moved under this consumer: cloud PR #1852 (the rolling 7-day free
 * quota) left `error.details.resetsTonight` a boolean but inverted its value
 * for the free plan (`true` -> `false`) and started sending an ISO `resetsAt`
 * beside it. `tool-display.ts` reads the flag and not the timestamp.
 *
 * #6385 already pinned that field — about its TYPE ("leaves `resetsTonight`
 * undefined unless a producer sends an actual boolean", `tool-display.test.ts`).
 * The type did not move. A value inversion and a new sibling key are exactly
 * what a type pin cannot see, so this file pins the CONSEQUENCE: the rendered
 * result.
 *
 * The measurement, taken here rather than assumed: after the parser populates
 * `resetsTonight`, NOTHING reads it. `useAiQuotaCopy` — the only consumer of
 * the parsed shape's fields — builds the banner from `message` / `messageEn` /
 * `topUp`; the two other `parseAiQuotaError` call sites in `ChatbotEnhanced`
 * use it as a yes/no predicate. So the free plan's inversion is invisible here,
 * and the answer to "does this render nothing, or does it render a false
 * promise?" is RENDERS NOTHING: every word the user gets about when the
 * allowance returns is the server's own sentence, passed through verbatim.
 *
 * That is worth pinning in both directions. The banner is pinned by exact
 * accounting (title + server sentence + CTA, and nothing else), so a reset line
 * of our own cannot appear unnoticed; and the flag is pinned as inert, so the
 * day someone wires "resets tonight" copy to a boolean that is now `false` for
 * exactly the plan that needs the answer, this file says so.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { parseAiQuotaError } from '../tool-display';

/** The server-owned refusal prose, as the cloud guardrail sends it. */
const FREE_PLAN_ZH = 'AI 额度已用完，9 月 13 日恢复；升级后可继续使用。';
const FREE_PLAN_EN =
  'Your free AI allowance is used up. It comes back on 13 Sep — upgrade to keep going.';
/** The ISO instant cloud PR #1852 added; no reader in this package. */
const RESETS_AT = '2026-09-13T00:00:00Z';

/**
 * The free plan's post-#1852 wire shape: the declared envelope (ADR-0112) with
 * the ledger code, `resetsTonight` now `false`, and `resetsAt` beside it —
 * tagged the way `sendAwareFetch` tags a POST refused before any tokens
 * streamed.
 */
function freePlanRefusal(resetsTonight: boolean): Error {
  const e = new Error(
    JSON.stringify({
      success: false,
      error: {
        code: 'AI_ALLOWANCE_EXHAUSTED',
        message: FREE_PLAN_ZH,
        category: 'rate_limit',
        details: {
          messageEn: FREE_PLAN_EN,
          upgrade: true,
          topUp: false,
          resetsTonight,
          resetsAt: RESETS_AT,
        },
      },
    }),
  ) as Error & { notSent?: boolean; status?: number };
  e.notSent = true;
  e.status = 429;
  return e;
}

function renderRefusal(resetsTonight: boolean) {
  return render(
    <ChatbotEnhanced
      placeholder="Ask…"
      messages={[]}
      onSendMessage={vi.fn()}
      onUpgrade={vi.fn()}
      error={freePlanRefusal(resetsTonight)}
    />,
  );
}

describe('free-plan 429 banner — the reset promise nobody makes (objectui#7587)', () => {
  it('renders the server sentence and nothing of our own about the reset', () => {
    renderRefusal(false);
    const banner = screen.getByRole('alert');

    // Exact accounting: three parts, each with a named source — our own title,
    // the server's sentence verbatim, and the CTA `topUp` picks. Anything this
    // package starts deriving from the 429's reset fields has to land inside
    // this string, so it cannot arrive unnoticed.
    expect(banner.textContent).toBe(`Upgrade needed${FREE_PLAN_EN}Upgrade plan`);

    // The two halves of "renders nothing": the instant the producer sent never
    // reaches the DOM, and no reset copy of our own stands in for it. (The
    // package HAS such copy for the separate `GET /api/v1/ai/usage` surface —
    // "Resets tonight" / "Resets in N days" in `@object-ui/i18n` — which is a
    // different envelope on a different screen, and none of it is here.)
    expect(banner.textContent).not.toContain(RESETS_AT);
    expect(banner.textContent).not.toMatch(/resets?\s+(?:tonight|tomorrow|in\b)/i);
  });

  it('renders identically whether the producer says resetsTonight true or false', () => {
    // The control first: the two envelopes really do differ where it counts,
    // so a green invariance below is a measurement and not a fixture that
    // forgot to vary its input.
    expect(parseAiQuotaError(freePlanRefusal(false))?.resetsTonight).toBe(false);
    expect(parseAiQuotaError(freePlanRefusal(true))?.resetsTonight).toBe(true);

    const first = renderRefusal(false);
    const withFalse = screen.getByRole('alert').innerHTML;
    first.unmount();

    const second = renderRefusal(true);
    const withTrue = screen.getByRole('alert').innerHTML;
    second.unmount();

    // The inversion cloud PR #1852 shipped changes not one byte of what the
    // free-plan user sees. That is the state #7587 measured this file into
    // existence to record — and the assertion that turns red the day the flag
    // alone starts driving copy, which is the failure the card feared.
    expect(withTrue).toBe(withFalse);
  });
});
