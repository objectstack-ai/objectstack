/**
 * objectui#12891 — a successful connect is silent.
 *
 * The chip renders nothing from the first frame on `connected`: no green
 * "Connected" flash, at any time. The outage and in-progress states keep
 * drawing their chip (control).
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ConnectionStatus } from '../ConnectionStatus';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ language: 'en', t: (key: string) => key }),
}));

describe('ConnectionStatus is silent when connected (objectui#12891)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing on the transition to connected, at any time', () => {
    const { container, rerender } = render(<ConnectionStatus state="connecting" />);
    expect(screen.getByTitle('topbar.connection.connecting')).toBeInTheDocument();

    rerender(<ConnectionStatus state="connected" />);
    expect(container).toBeEmptyDOMElement();
    for (const ms of [0, 1, 1000, 1999, 2000, 60_000]) {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
      expect(container).toBeEmptyDOMElement();
    }
  });

  it('renders nothing when mounted already connected', () => {
    const { container } = render(<ConnectionStatus state="connected" />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['connecting', 'reconnecting', 'disconnected', 'error'] as const)(
    'control: %s still draws its chip',
    (state) => {
      render(<ConnectionStatus state={state} />);
      expect(screen.getByTitle(`topbar.connection.${state}`)).toBeInTheDocument();
    },
  );
});
