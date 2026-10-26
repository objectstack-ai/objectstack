/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * AiUsageIndicator (ADR-0057 #8) — renders ONE gauge for the ONE AI quota pool
 * (objectui#8524), hides itself when there's nothing to show (fail-soft), surfaces
 * a "running low" hint near the cap, offers the upgrade / top-up CTA (reusing the
 * 429 deep-link), and shows ONE figure in the popover — the pool's used share —
 * never the build / data-Q&A split (objectui#11658). Never a token #.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AiUsageResponse, AiMeterUsage } from '../../hooks/useAiUsage';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    // Interpolates `{{name}}` from the options object (mirrors real i18next
    // closely enough for count-driven copy like `resetsWeeklyDays`) — a plain
    // `String(options?.defaultValue ?? key)` would leave `{{count}}` literal.
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
        String(options?.[name] ?? ''),
      ),
    language: 'en',
  }),
}));
const openMock = vi.fn();
vi.mock('../../console/marketplace/marketplaceApi', () => ({
  cloudConsoleUrl: () => 'https://cloud.example',
}));
vi.mock('../../hooks/useAiUsage', () => ({ useAiUsage: vi.fn() }));
// objectui#11799 — the indicator reads usage only while the agent catalog lists
// an agent, so every case here is a viewer with AI on. AI off is pinned in
// `AiUsageIndicator.aiOff-11799.test.tsx`, over the real catalog hook.
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAgents: () => ({ agents: [{ name: 'ask', label: 'Ask' }], isLoading: false, error: undefined, refetch: () => {} }),
}));

import { useAiUsage } from '../../hooks/useAiUsage';
import { AiUsageIndicator } from '../AiUsageIndicator';

// The REAL hook, for the cases that drive a wire payload through the parser
// into the component. Loaded at module scope so its import cost is paid in the
// import phase, never inside a test's bounded window.
const { useAiUsage: realUseAiUsage } =
  await vi.importActual<typeof import('../../hooks/useAiUsage')>('../../hooks/useAiUsage');

const pool = (over: Partial<AiMeterUsage> = {}): AiMeterUsage => ({
  planType: 'free',
  fraction: 0.3,
  unmetered: false,
  resetKind: 'daily',
  resetsAt: null,
  upgrade: true,
  topUp: false,
  ...over,
});

function setUsage(usage: AiUsageResponse | null) {
  (useAiUsage as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    usage,
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  });
}

/** Gauges drawn inside an element — each `MeterGauge` is one `svg`. */
const ringsIn = (el: HTMLElement) => el.querySelectorAll('svg').length;

describe('AiUsageIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('open', openMock);
  });

  it('renders nothing when usage is unknown (null)', () => {
    setUsage(null);
    const { container } = render(<AiUsageIndicator apiBase="/api/v1/ai" />);
    expect(screen.queryByTestId('ai-usage-indicator')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the pool is unmetered', () => {
    setUsage({ pool: pool({ unmetered: true, fraction: null }) });
    render(<AiUsageIndicator apiBase="/api/v1/ai" />);
    expect(screen.queryByTestId('ai-usage-indicator')).not.toBeInTheDocument();
  });

  it('renders nothing when the pool fraction is unknown (null)', () => {
    setUsage({ pool: pool({ fraction: null }), breakdown: { build: null, dataChat: null } });
    render(<AiUsageIndicator apiBase="/api/v1/ai" />);
    expect(screen.queryByTestId('ai-usage-indicator')).not.toBeInTheDocument();
  });

  it('draws ONE ring for the pool, even when the split is measured', () => {
    setUsage({ pool: pool({ fraction: 0.5 }), breakdown: { build: 0.3, dataChat: 0.2 } });
    render(<AiUsageIndicator apiBase="/api/v1/ai" />);
    const trigger = screen.getByTestId('ai-usage-indicator');
    expect(ringsIn(trigger)).toBe(1);
    // No token numbers anywhere in the rendered output (D5).
    expect(trigger.textContent ?? '').not.toMatch(/\d{3,}/);
  });

  it('shows a "running low" hint when the pool is near full', () => {
    setUsage({ pool: pool({ fraction: 0.9 }) });
    render(<AiUsageIndicator apiBase="/api/v1/ai" />);
    expect(screen.getByText('Running low')).toBeInTheDocument();
  });

  it('does not show the low hint when the pool has headroom', () => {
    setUsage({ pool: pool({ fraction: 0.2 }) });
    render(<AiUsageIndicator apiBase="/api/v1/ai" />);
    expect(screen.queryByText('Running low')).not.toBeInTheDocument();
  });

  it('opens the upgrade deep-link from the CTA when a free pool is near full', () => {
    setUsage({ pool: pool({ fraction: 0.95, upgrade: true }) });
    render(<AiUsageIndicator apiBase="/api/v1/ai" />);
    fireEvent.click(screen.getByTestId('ai-usage-indicator'));
    fireEvent.click(screen.getByTestId('ai-usage-cta'));
    expect(openMock).toHaveBeenCalledWith('https://cloud.example', '_blank', 'noopener,noreferrer');
  });

  // objectui#11658 item 3 — the popover shows ONE figure. The pool's split
  // (`breakdown`) read「AI 搭建 19% · 数据问询 0%」after a data question asked
  // through the single composer: it cannot attribute a composer turn, so it is
  // not drawn, whatever the wire carries.
  describe('the popover figure (one meter)', () => {
    it("shows the pool's used share as one percentage — and no split, even when the split is measured", () => {
      setUsage({ pool: pool({ fraction: 0.19 }), breakdown: { build: 0.19, dataChat: 0 } });
      render(<AiUsageIndicator apiBase="/api/v1/ai" />);
      fireEvent.click(screen.getByTestId('ai-usage-indicator'));
      const popover = screen.getByTestId('ai-usage-popover');
      expect(screen.getByTestId('ai-usage-pool-used')).toHaveTextContent('19% used');
      // Exactly one percentage in the whole popover: the pool's.
      expect(popover.textContent?.match(/\d+\s?%/g)).toEqual(['19%']);
      expect(screen.queryByTestId('ai-usage-breakdown')).not.toBeInTheDocument();
      expect(popover).not.toHaveTextContent('Build');
      expect(popover).not.toHaveTextContent('Ask');
      expect(ringsIn(popover)).toBe(1);
    });

    it('with no breakdown at all: the same one figure', () => {
      setUsage({ pool: pool({ fraction: 0.5 }) });
      render(<AiUsageIndicator apiBase="/api/v1/ai" />);
      expect(ringsIn(screen.getByTestId('ai-usage-indicator'))).toBe(1);
      fireEvent.click(screen.getByTestId('ai-usage-indicator'));
      expect(screen.getByTestId('ai-usage-pool-used')).toHaveTextContent('50% used');
    });
  });

  // objectui#11658 item 4 — at low usage the old ring was a short stroked arc
  // over a faint track: the silhouette of a loading spinner. The gauge is a
  // CLOSED outline in the tone colour around a pie wedge, which reads as a
  // quantity at any fraction.
  describe('the gauge glyph (not a spinner)', () => {
    const parts = (svg: SVGElement) => ({
      track: svg.querySelector('[data-gauge-part="track"]'),
      fill: svg.querySelector('[data-gauge-part="fill"]'),
    });

    it.each([0, 0.05, 0.19])('at %s: a full, tone-coloured track around a pie wedge', (fraction) => {
      setUsage({ pool: pool({ fraction }) });
      render(<AiUsageIndicator apiBase="/api/v1/ai" />);
      const svg = screen.getByTestId('ai-usage-indicator').querySelector('svg') as SVGElement;
      const { track, fill } = parts(svg);
      // The track is a closed circle: undashed, drawn in the tone colour, no
      // faded-out opacity class — as visible as the fill.
      expect(track).not.toBeNull();
      expect(track?.getAttribute('stroke')).toBe('currentColor');
      expect(track?.hasAttribute('stroke-dasharray')).toBe(false);
      expect(track?.getAttribute('class') ?? '').not.toMatch(/\/\d+/);
      // The fill is a pie: a circle whose stroke is as wide as its diameter
      // (a sector of a disc), inside the track — never an arc ON the track.
      const r = Number(fill?.getAttribute('r'));
      expect(Number(fill?.getAttribute('stroke-width'))).toBeCloseTo(2 * r);
      expect(Number(track?.getAttribute('r'))).toBeGreaterThan(2 * r);
      // The wedge's share is the pool's fraction.
      const [dash, gap] = (fill?.getAttribute('stroke-dasharray') ?? '').split(' ').map(Number);
      expect(dash / gap).toBeCloseTo(fraction);
    });
  });

  // The wire payload through the REAL parser into the component — the path
  // that went blank when the endpoint became one pool (objectui#8524).
  describe('through the real hook', () => {
    const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
    // What the real hook last handed the component — read to know the fetch has
    // settled, so an empty DOM is a reading and not the pre-fetch first frame.
    let last: ReturnType<typeof realUseAiUsage> | undefined;

    beforeEach(() => {
      last = undefined;
      (useAiUsage as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (options: Parameters<typeof realUseAiUsage>[0]) => (last = realUseAiUsage(options)),
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('renders the ring for a `{ pool }` answer that carries no `breakdown`', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ pool: pool({ fraction: 0.4 }) })));
      render(<AiUsageIndicator apiBase="/api/v1/ai" />);
      const trigger = await screen.findByTestId('ai-usage-indicator');
      expect(ringsIn(trigger)).toBe(1);
      expect(last?.error).toBeUndefined();
    });

    it('renders nothing for the retired per-meter `{ meters }` answer', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          okResponse({ meters: { build: pool({ fraction: 0.4 }), dataChat: pool({ fraction: 0.1 }) } }),
        ),
      );
      const { container } = render(<AiUsageIndicator apiBase="/api/v1/ai" />);
      await waitFor(() => expect(last?.error).toBeDefined());
      expect(last?.usage).toBeNull();
      expect(container).toBeEmptyDOMElement();
    });

    // objectui#11415 — cloud#2574's wire vocabulary reaches the reset line.
    it('renders the reset line for a `resetKind: fiveHour` answer', async () => {
      const resetsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(okResponse({ pool: pool({ resetKind: 'fiveHour', resetsAt }) })),
      );
      render(<AiUsageIndicator apiBase="/api/v1/ai" />);
      fireEvent.click(await screen.findByTestId('ai-usage-indicator'));
      expect(screen.getByText('Resets in 2 hours')).toBeInTheDocument();
      expect(last?.error).toBeUndefined();
    });
  });

  // objectui#7371 — the free plan's `resetKind: 'weekly'` (cloud PR #1852).
  describe('resetKind: weekly', () => {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const ONE_DAY_MS = 24 * ONE_HOUR_MS;

    it('shows "N days" when resetsAt is more than a day out', () => {
      const resetsAt = new Date(Date.now() + 3 * ONE_DAY_MS).toISOString();
      setUsage({ pool: pool({ resetKind: 'weekly', resetsAt }) });
      render(<AiUsageIndicator apiBase="/api/v1/ai" />);
      fireEvent.click(screen.getByTestId('ai-usage-indicator'));
      expect(screen.getByText('Resets in 3 days')).toBeInTheDocument();
    });

    it('switches to hours when resetsAt is within a day (D5: never a token count)', () => {
      const resetsAt = new Date(Date.now() + 5 * ONE_HOUR_MS).toISOString();
      setUsage({ pool: pool({ resetKind: 'weekly', resetsAt }) });
      render(<AiUsageIndicator apiBase="/api/v1/ai" />);
      fireEvent.click(screen.getByTestId('ai-usage-indicator'));
      expect(screen.getByText('Resets in 5 hours')).toBeInTheDocument();
    });

    it('shows no reset line when weekly has no resetsAt yet — contract-first, never guessed client-side', () => {
      setUsage({ pool: pool({ resetKind: 'weekly', resetsAt: null }) });
      render(<AiUsageIndicator apiBase="/api/v1/ai" />);
      fireEvent.click(screen.getByTestId('ai-usage-indicator'));
      expect(screen.queryByText(/Resets/)).not.toBeInTheDocument();
    });

    it('falls back to no reset line (not a crash or stale copy) on an unrecognized resetKind', () => {
      // Cast past the union: a future backend value this build doesn't know yet.
      setUsage({ pool: pool({ resetKind: 'quarterly' as unknown as AiMeterUsage['resetKind'] }) });
      expect(() => render(<AiUsageIndicator apiBase="/api/v1/ai" />)).not.toThrow();
      fireEvent.click(screen.getByTestId('ai-usage-indicator'));
      expect(screen.queryByText(/Resets/)).not.toBeInTheDocument();
    });
  });

  // objectui#11415 — the rolling 5-hour pace window (cloud#2059, `resetKind:
  // 'fiveHour'`). When it binds, this line is what tells a user who hit the
  // wall when they can continue; it is read from `resetsAt` alone, like weekly.
  describe('resetKind: fiveHour', () => {
    const ONE_HOUR_MS = 60 * 60 * 1000;

    it('reads "Resets in 3 hours" for a reset instant 3 hours out', () => {
      const resetsAt = new Date(Date.now() + 3 * ONE_HOUR_MS).toISOString();
      setUsage({ pool: pool({ resetKind: 'fiveHour', resetsAt }) });
      render(<AiUsageIndicator apiBase="/api/v1/ai" />);
      fireEvent.click(screen.getByTestId('ai-usage-indicator'));
      expect(screen.getByText('Resets in 3 hours')).toBeInTheDocument();
    });

    it('rounds a reset under an hour away up to 1, never "0 hours"', () => {
      const resetsAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      setUsage({ pool: pool({ resetKind: 'fiveHour', resetsAt }) });
      render(<AiUsageIndicator apiBase="/api/v1/ai" />);
      fireEvent.click(screen.getByTestId('ai-usage-indicator'));
      // The test `t` interpolates `defaultValue` without plural selection, so
      // the count is what is pinned here, not the plural form.
      expect(screen.getByText(/^Resets in 1 hours?$/)).toBeInTheDocument();
      expect(screen.queryByText(/Resets in 0\b/)).not.toBeInTheDocument();
    });

    it('shows no reset line while resetsAt is null — nothing counted yet, never guessed client-side', () => {
      setUsage({ pool: pool({ resetKind: 'fiveHour', resetsAt: null }) });
      render(<AiUsageIndicator apiBase="/api/v1/ai" />);
      fireEvent.click(screen.getByTestId('ai-usage-indicator'));
      expect(screen.queryByText(/Resets/)).not.toBeInTheDocument();
    });
  });
});
