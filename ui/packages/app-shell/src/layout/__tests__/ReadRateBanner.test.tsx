/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * ReadRateBanner (objectui#9954) — renders ONLY on the control plane's
 * `anomalous` verdict, gives the no-writes reading its own words, takes the
 * line from the wire, and stays a report.
 *
 * `classifyReadRate` is deliberately NOT mocked (only the data hook is), so
 * these cases exercise the same classifier the component ships with.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReadRateSnapshot } from '../../hooks/useReadRateReading';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Interpolates `{{name}}` from the options object, the way the real i18next
  // does for this copy's `{{ratio}}` / `{{threshold}}` holes.
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
        String(options?.[name] ?? ''),
      ),
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: vi.fn(),
}));
vi.mock('../../hooks/useReadRateReading', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReadRateReading: vi.fn(),
}));

import { useWorkspaceAdminStatus } from '@object-ui/auth';
import { useReadRateReading } from '../../hooks/useReadRateReading';
import { ReadRateBanner } from '../ReadRateBanner';

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

function setAdmin(isAdmin: boolean) {
  asMock(useWorkspaceAdminStatus).mockReturnValue({ isAdmin, isResolved: true });
}

function setSnapshot(snapshot: ReadRateSnapshot) {
  asMock(useReadRateReading).mockReturnValue({ ...snapshot, refetch: vi.fn() });
}

const ANOMALOUS_RATIO: ReadRateSnapshot = {
  status: 'measured',
  reading: { state: 'anomalous', readsPerWrite: 4210.5, ratioThreshold: 500 },
};
const ANOMALOUS_NO_WRITES: ReadRateSnapshot = {
  status: 'measured',
  reading: { state: 'anomalous', ratioThreshold: 500 },
};

describe('ReadRateBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAdmin(true);
  });

  it('renders on an anomalous ratio, showing the ratio and the line it was taken against', () => {
    setSnapshot(ANOMALOUS_RATIO);
    render(<ReadRateBanner />);

    const banner = screen.getByTestId('read-rate-banner');
    expect(banner).toHaveAttribute('data-read-rate-case', 'anomalous-ratio');
    expect(banner).toHaveTextContent('4,210.5');
    expect(banner).toHaveTextContent('500');
  });

  // Property (1) — both "no reading at all" and "measured and under the line"
  // render nothing, and the third silent answer (unreadable) does too.
  it.each([
    ['the control plane reported no reading', { status: 'unmeasured', reading: null }],
    ['the endpoint could not be read', { status: 'unavailable', reading: null }],
    ['nothing is known yet', { status: 'loading', reading: null }],
    [
      'measured and under the line',
      { status: 'measured', reading: { state: 'ok', readsPerWrite: 3, ratioThreshold: 500 } },
    ],
  ] as Array<[string, ReadRateSnapshot]>)('renders nothing when %s', (_label, snapshot) => {
    setSnapshot(snapshot);
    const { container } = render(<ReadRateBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  // Property (2) — an absent `readsPerWrite` is the WORST reading, so it gets
  // its own title and its own sentence, is never hidden, and never renders as a
  // missing value.
  it('gives the no-writes reading its own words and never a dash', () => {
    setSnapshot(ANOMALOUS_NO_WRITES);
    render(<ReadRateBanner />);

    const banner = screen.getByTestId('read-rate-banner');
    expect(banner).toHaveAttribute('data-read-rate-case', 'anomalous-no-writes');
    const noWritesText = banner.textContent ?? '';
    expect(noWritesText).toMatch(/no upper bound/i);
    expect(noWritesText).toMatch(/most severe/i);
    expect(noWritesText).not.toMatch(/—/);
  });

  it('says something DIFFERENT for the no-writes case than for a ratio', () => {
    setSnapshot(ANOMALOUS_RATIO);
    const ratio = render(<ReadRateBanner />);
    const ratioText = ratio.container.textContent ?? '';
    ratio.unmount();

    setSnapshot(ANOMALOUS_NO_WRITES);
    const noWrites = render(<ReadRateBanner />);
    const noWritesText = noWrites.container.textContent ?? '';

    // Asserted before the comparison: an empty render would satisfy "different
    // from the ratio copy" while proving nothing — and a hidden no-writes banner
    // is the exact defect this case exists to catch.
    expect(noWrites.getByTestId('read-rate-banner')).toBeInTheDocument();
    expect(noWritesText).not.toBe(ratioText);
    expect(ratioText).toMatch(/rows for every row written/i);
    expect(noWritesText).not.toMatch(/rows for every row written/i);
  });

  // Property (3) — the line is DATA. Two different thresholds must produce two
  // different renderings; a hard-coded copy of the line cannot do that.
  it('takes the threshold from the reading, with no copy of the line in this repo', () => {
    setSnapshot({
      status: 'measured',
      reading: { state: 'anomalous', readsPerWrite: 900, ratioThreshold: 42 },
    });
    const first = render(<ReadRateBanner />);
    expect(first.container).toHaveTextContent('42');
    first.unmount();

    setSnapshot({
      status: 'measured',
      reading: { state: 'anomalous', readsPerWrite: 900, ratioThreshold: 7 },
    });
    const second = render(<ReadRateBanner />);
    expect(second.container).toHaveTextContent('7');
    expect(second.container).not.toHaveTextContent('42');
  });

  // The landed cloud module's own words: nothing downstream may turn this into a
  // refusal, a throttle or a degraded read.
  it('is a report — no control to press, and the copy says nothing is limited', () => {
    setSnapshot(ANOMALOUS_RATIO);
    render(<ReadRateBanner />);

    const banner = screen.getByTestId('read-rate-banner');
    expect(banner.querySelector('button')).toBeNull();
    expect(banner.querySelector('a')).toBeNull();
    expect(banner).toHaveTextContent(/nothing is limited or blocked/i);
    expect(banner.textContent ?? '').not.toMatch(/upgrade|throttl|blocked until|quota exceeded/i);
  });

  it('is for the environment admin — an ordinary session renders nothing and issues no request', () => {
    setAdmin(false);
    setSnapshot({ status: 'idle', reading: null });
    const { container } = render(<ReadRateBanner />);

    expect(container).toBeEmptyDOMElement();
    expect(asMock(useReadRateReading)).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });
});
