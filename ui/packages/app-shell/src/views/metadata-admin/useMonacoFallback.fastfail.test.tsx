/**
 * When Monaco's CDN loader script fails outright (offline / air-gapped / CSP —
 * the console embeds in servers that ship a strict CSP), `loader.init()`
 * rejects. The editor must fall back to the textarea IMMEDIATELY rather than
 * making the user wait out the DOM-poll grace period. We prove the fast path by
 * setting a very long `fallbackDelayMs`: if the textarea appears, it can only be
 * because the rejected `loader.init()` tripped it, not the poll.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// `Editor` and `default` are ONE declaration in the real package, and the
// component under test imports the NAMED one (objectui#5440), so the stub is
// bound to both names rather than to `default` alone.
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return {
    Editor,
    default: Editor,
    // Simulate the CDN loader script failing to load.
    loader: { init: () => Promise.reject(new Error('CDN blocked')) },
  };
});

import { JsonSourceEditor } from './JsonSourceEditor';

describe('useMonacoFallback — fast-fail on CDN/loader rejection', () => {
  it('shows the textarea immediately when loader.init() rejects, without waiting out fallbackDelayMs', async () => {
    const draft = { name: 'work_order', fields: { title: { type: 'text' } } };
    // Long grace period: only the fast path can satisfy this within the timeout.
    render(<JsonSourceEditor value={draft} onChange={() => {}} fallbackDelayMs={60_000} />);

    const ta = (await screen.findByLabelText(
      'JSON source',
      {},
      { timeout: 2000 },
    )) as HTMLTextAreaElement;

    expect(ta.value).toContain('work_order');
  });
});
