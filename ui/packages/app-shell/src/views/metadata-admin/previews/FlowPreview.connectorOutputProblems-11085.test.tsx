// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11085 — the Problems panel's HOST reads the runtime connector
 * registry and hands it to `buildFlowProblems`, so a later node's reference to
 * a committed connector action's declared output (`post.ok`) is judged in scope
 * on every surface fed by the one `problems` list: the Problems panel's rows
 * and the canvas node badge. (The inline banner lists error-level problems
 * only, so a scope warning never reached it.)
 *
 * Mounted through the real `FlowPreview`, with `fetch` answering the registry
 * route and a 404 everywhere else (the canvas palette's normal offline answer).
 *
 * Controls on the same draft: a root no node writes (`ghost.ok`) is still
 * reported with the registry served, and `post.ok` is still reported when the
 * registry is not served — the host's read is what clears it. The note's
 * wording is not pinned: each probe asserts only whether a row or a badge
 * names the root.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';

import { t, tFormat } from '../i18n';
import { FlowPreview } from './FlowPreview';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const REGISTRY = [
  {
    name: 'slack',
    label: 'Slack',
    actions: [
      { key: 'chat.postMessage', label: 'Post Message', outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } } },
    ],
  },
];

function stubFetch(serveRegistry: boolean): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: unknown) => {
    if (serveRegistry && String(url).includes('/automation/connectors')) {
      return new Response(JSON.stringify({ success: true, data: { connectors: REGISTRY } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** A committed connector action, then a decision that reads `condition`. */
function draft(condition: string, connectorConfig: Record<string, unknown> = { connectorId: 'slack', actionId: 'chat.postMessage' }) {
  return {
    name: 'notify_flow',
    // A declared variable keeps the scope non-empty, so the reference check runs.
    variables: [{ name: 'threshold', type: 'number' }],
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'post', type: 'connector_action', label: 'Send message', connectorConfig },
      { id: 'check', type: 'decision', label: 'Sent?', config: { condition } },
      { id: 'done', type: 'end' },
    ],
    edges: [
      { source: 'start', target: 'post' },
      { source: 'post', target: 'check' },
      { source: 'check', target: 'done' },
    ],
  };
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount(d: Record<string, unknown>, fetchMock: ReturnType<typeof vi.fn>, expectRegistryRead = true) {
  render(<FlowPreview type="flow" name="notify_flow" draft={d} locale="en-US" />);
  if (expectRegistryRead) {
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/automation/connectors'))).toBe(true));
  }
  await flush();
  await flush();
}

/** Every Problems-panel row's message, after opening the panel. */
function panelMessages(): string[] {
  fireEvent.click(screen.getByTitle(t('engine.flowPreview.problemsTitle', 'en-US')));
  // The panel's title is a span; the toolbar toggle beside it can read the same word.
  const title = screen.getAllByText(t('engine.flowProblems.title', 'en-US')).find((el) => el.tagName === 'SPAN');
  expect(title, 'the Problems panel title').toBeTruthy();
  const panel = title!.parentElement!.parentElement as HTMLElement;
  return within(panel)
    .queryAllByRole('listitem')
    .map((li) => li.querySelector('span.block')?.textContent ?? '');
}

/** Every canvas badge's title (the folded messages of its element). */
function badgeTitles(): string[] {
  return Array.from(document.querySelectorAll('[data-problem]')).map((el) => el.getAttribute('title') ?? '');
}

const naming = (root: string) => (text: string) => new RegExp(`\\b${root}\\b`).test(text);

describe('FlowPreview — the Problems panel judges a connector action’s declared output in scope (objectui#11085)', () => {
  it('`post.ok` on a later decision draws no panel row and no badge once the registry is read', async () => {
    const fetchMock = stubFetch(true);
    await mount(draft('post.ok == true'), fetchMock);

    expect(badgeTitles().filter(naming('post'))).toEqual([]);
    expect(panelMessages().filter(naming('post'))).toEqual([]);
  });

  it('lit control: with the registry unanswered, the same reference is still reported on the panel and the badge', async () => {
    const fetchMock = stubFetch(false);
    await mount(draft('post.ok == true'), fetchMock);

    expect(badgeTitles().filter(naming('post'))).toHaveLength(1);
    expect(panelMessages().filter(naming('post'))).toHaveLength(1);
  });

  it('control: a root no node writes is still reported with the registry read', async () => {
    const fetchMock = stubFetch(true);
    await mount(draft('ghost.ok == true'), fetchMock);

    expect(badgeTitles().filter(naming('ghost'))).toHaveLength(1);
    // objectui#11838 — `ghost.ok` reads a node this flow does not have, so beside
    // the scope warning the panel lists that as an error of its own.
    const rows = panelMessages().filter(naming('ghost'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe(tFormat('engine.flowValidate.exprRefNodeMissing', 'en-US', { ref: 'ghost.ok', id: 'ghost' }));
  });

  it('a flow with no committed connector action never reads the registry', async () => {
    const fetchMock = stubFetch(true);
    await mount(draft('post.ok == true', { connectorId: 'slack' }), fetchMock, false);

    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/automation/connectors'))).toBe(false);
    // …and the reference is judged exactly as before: not in scope.
    expect(panelMessages().filter(naming('post'))).toHaveLength(1);
  });
});
