/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11800 — when Monaco cannot be loaded, nothing escapes as an
 * uncaught error and the failure is reported once per page, as one console
 * line naming what could not be fetched.
 *
 * Monaco is the host's own bundled chunk (plugin-editor's
 * `configureBundledMonaco` hands it to the loader before the page's one
 * `loader.init()`), so what can fail is fetching that chunk, and the loader's
 * CDN default is never reached: no loader `<script>` is appended at all.
 *
 * This drives the REAL `@monaco-editor/loader` and the real `<Editor>`; the
 * chunk's own import is plugin-editor's `configureBundledMonaco`, whose suite
 * drives it against the real loader. Two pieces of browser behaviour are
 * modelled, and only these two:
 *
 *  - **The network.** `configureBundledMonaco` waits until the test lets the
 *    chunk fail, AFTER the lazy editor module has loaded — the order a slow
 *    network gives, where the editor module is in before the chunk's answer.
 *  - **Unhandled rejections.** Node reports a rejection nobody handled on
 *    `process`; a browser dispatches a cancelable `unhandledrejection` event on
 *    `window` and reports an uncaught error only if no listener cancelled it.
 *    For the duration of each test the harness replays every Node report as
 *    that window event and counts the ones left uncancelled. Vitest's own
 *    listeners are put back afterwards.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, act } from '@testing-library/react';

import { SourcePageEditor } from './previews/SourcePageEditor';
import { JsonSourceEditor } from '../item-tools/JsonSourceEditor';

const LOADER_SCRIPT = /\/vs\/loader\.js$/;
const CHUNK_URL = 'http://localhost/_console/assets/editor.api2-hash.js';

const chunk = vi.hoisted(() => {
  let fail!: () => void;
  const answered = new Promise<void>((resolve) => {
    fail = resolve;
  });
  return { answered, fail: () => fail() };
});

// The bundled Monaco chunk cannot be fetched: plugin-editor's
// `configureBundledMonaco` rejects, as its import of the chunk does, once the
// test says the network answered.
vi.mock('@object-ui/plugin-editor', () => ({
  configureBundledMonaco: async () => {
    await chunk.answered;
    throw new TypeError(`Failed to fetch dynamically imported module: ${CHUNK_URL}`);
  },
}));

let uncaught: unknown[] = [];
let vitestListeners: NodeJS.UnhandledRejectionListener[] = [];
let heldLoaderScripts: HTMLScriptElement[] = [];

function replayAsBrowser(reason: unknown): void {
  const event = new Event('unhandledrejection', { cancelable: true });
  Object.defineProperty(event, 'reason', { value: reason });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) uncaught.push(reason);
}

/** The console lines that speak about Monaco — other warnings on the page are not this card's. */
function monacoReports(calls: unknown[][]): string[] {
  return calls.map((args) => args.map(String).join(' ')).filter((line) => /monaco/i.test(line));
}

/** Let Node finish a microtask checkpoint and report what it left unhandled. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  uncaught = [];
  heldLoaderScripts = [];
  vitestListeners = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', replayAsBrowser);

  const append = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLScriptElement && LOADER_SCRIPT.test(node.src)) {
      heldLoaderScripts.push(node);
      return node;
    }
    return append(node);
  });
});

afterEach(() => {
  process.off('unhandledRejection', replayAsBrowser);
  for (const listener of vitestListeners) process.on('unhandledRejection', listener);
  vi.restoreAllMocks();
});

const draft = { name: 'probe_page', type: 'home', kind: 'html', source: '' };

describe('useMonacoFallback — a Monaco chunk that cannot be fetched (objectui#11800)', () => {
  it('leaks no uncaught rejection, reaches no CDN, and reports the chunk URL once per page, across the Studio shape and a reopen', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const consoleWarn = vi.spyOn(console, 'warn');

    // The Studio's source-page shape: the canvas preview and the inspector
    // editor each run the hook; StrictMode doubles every effect, as the dev
    // build does.
    render(
      <React.StrictMode>
        <SourcePageEditor mode="preview" draft={draft} readOnly />
        <SourcePageEditor mode="editor" draft={draft} onPatch={() => {}} fallbackDelayMs={60_000} />
      </React.StrictMode>,
    );

    // Let the lazy editor module load, so an editor that mounts before the
    // chunk answers has had every chance to.
    await act(async () => {
      await import('@monaco-editor/react');
    });
    await settle();

    // The network answers: the chunk could not be fetched.
    await act(async () => {
      chunk.fail();
    });

    const fallback = await screen.findByLabelText('Page source', {}, { timeout: 2000 });
    expect(fallback.tagName).toBe('TEXTAREA');
    await settle();

    // Soft, so a regression reports every reading at once, not just the first.
    expect.soft(uncaught, 'uncaught rejections after the chunk failed').toHaveLength(0);
    const editorInitErrors = consoleError.mock.calls.filter(
      ([first]) => typeof first === 'string' && first.startsWith('Monaco initialization'),
    );
    expect.soft(editorInitErrors, "<Editor>'s own init error lines").toHaveLength(0);
    const reports = monacoReports(consoleWarn.mock.calls);
    expect.soft(reports, 'console lines reporting the Monaco failure').toHaveLength(1);
    expect.soft(reports.join('\n'), 'the report names the chunk URL').toContain(CHUNK_URL);
    expect.soft(heldLoaderScripts, "loader scripts appended (the loader's CDN default)").toHaveLength(0);

    // Reopen: a source editor mounted after the failure is known. Same page,
    // so no second report, no second script, and nothing uncaught.
    render(<JsonSourceEditor value={{ name: 'work_order' }} onChange={() => {}} fallbackDelayMs={60_000} />);
    const json = (await screen.findByLabelText('JSON source', {}, { timeout: 2000 })) as HTMLTextAreaElement;
    expect(json.value).toContain('work_order');
    await settle();

    expect.soft(uncaught, 'uncaught rejections after a reopen').toHaveLength(0);
    expect.soft(heldLoaderScripts, 'loader scripts after a reopen').toHaveLength(0);
    expect.soft(monacoReports(consoleWarn.mock.calls), 'reports after a reopen').toHaveLength(1);

    // Only the failure's own rejection is cancelled: any other one on the page
    // is still reported.
    const unrelated = new Error('an unrelated rejection');
    const before = uncaught.length;
    void Promise.reject(unrelated);
    await settle();
    expect(uncaught.slice(before), 'a rejection the loader did not make').toEqual([unrelated]);
  });
});
