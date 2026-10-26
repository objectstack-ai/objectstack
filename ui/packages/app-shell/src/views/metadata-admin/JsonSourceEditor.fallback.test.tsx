/**
 * F5 (objectui#1926): when Monaco can't paint — offline / air-gapped / CSP /
 * blocked web workers — the Source tab must NOT be a blank panel. It falls back
 * to a plain, editable textarea showing the JSON source. We simulate the
 * "Monaco renders nothing" condition by mocking the editor to render null, so
 * no `.view-line` ever appears and the fallback engages.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Monaco "loads" (loader.init resolves) but renders nothing, so the DOM-poll
// backstop — not the loader fast-fail path — is what must engage here.
//
// `Editor` and `default` are ONE declaration in the real package, and the
// component under test imports the NAMED one (objectui#5440), so the stub is
// bound to both names rather than to `default` alone.
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.resolve({}) } };
});

import { JsonSourceEditor } from './JsonSourceEditor';

describe('JsonSourceEditor — F5 textarea fallback', () => {
  it('shows an editable textarea with the JSON source when Monaco does not paint', async () => {
    const draft = { name: 'work_order', fields: { title: { type: 'text' } } };
    render(<JsonSourceEditor value={draft} onChange={() => {}} fallbackDelayMs={20} />);

    const ta = (await screen.findByLabelText(
      'JSON source',
      {},
      { timeout: 2000 },
    )) as HTMLTextAreaElement;

    expect(ta.value).toContain('work_order');
    expect(ta.value).toContain('title');
  });
});
