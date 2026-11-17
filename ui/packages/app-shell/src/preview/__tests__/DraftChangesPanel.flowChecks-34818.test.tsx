// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The pending-changes sheet lists what a flow draft's publish will report,
 * BEFORE the publish — objectstack#34818 item 1.
 *
 * The card's walk: a new flow with an unconfigured branch, 全部发布, and only
 * then a toast carrying two findings that vanished on a timer. The server now
 * folds the publish gate's advisories into the flow draft's read, worded for
 * the builder; this suite pins that the sheet shows those sentences beside the
 * Publish button, under the flow's label, as sent — that it stays silent when
 * the draft has nothing to report — that it never takes the button away — and
 * that a publish from here is marked as one whose checks the author reviewed,
 * for its flight only (the toast then keeps its one title line).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// Same targeted override as the sibling security suite: `@object-ui/components`
// pulls `createSafeTranslation` from this module, so a bare object mock breaks
// at import time rather than at assert time.
vi.mock('@object-ui/i18n', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/i18n')>();
  return {
    ...mod,
    useObjectTranslation: () => ({
      t: (_k: string, o?: { defaultValue?: string; count?: number }) =>
        (o?.defaultValue ?? _k).replace('{{count}}', String(o?.count ?? '')),
      language: 'zh-CN',
    }),
  };
});

import { DraftChangesPanel } from '../DraftChangesPanel';
import { werePublishChecksShown } from '../publishChecksShown';
// Warm the lint package at module scope, as the sibling security suites do:
// the sheet's security lint loads it with a function-body import.
import '@objectstack/lint';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ADVISORY_ZH =
  '流程“会议提醒”中的条件分支“检查日期”没有为任何一条连线（“提醒负责人”、“跳过”）设置条件，因此每次运行都会走所有连线，这个分支起不到选择作用。请为每条连线设置条件，并把其中一条设为默认分支。';

function mockRoutes(warnings: Array<{ path?: string; message: string }>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/_drafts')) {
      return ok([{ type: 'flow', name: 'xin_huiyi_tixing', packageId: 'app.minutes', label: '会议提醒' }]);
    }
    if (url.includes('state=draft')) {
      return ok({
        type: 'flow',
        name: 'xin_huiyi_tixing',
        item: {
          name: 'xin_huiyi_tixing',
          label: '会议提醒',
          nodes: [],
          edges: [],
          _diagnostics: { valid: true, errors: [], warnings },
        },
      });
    }
    if (/\/meta\/flow(\?|$)/.test(url)) return ok([]);
    return { ok: false, status: 404, json: async () => ({}) };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const renderPanel = (onPublish: () => void | Promise<void> = vi.fn()) =>
  render(<DraftChangesPanel open onOpenChange={() => {}} packageId="app.minutes" onPublish={onPublish} />);

describe('DraftChangesPanel — the flow publish checks, before the publish (objectstack#34818)', () => {
  it('lists the server sentence under the flow label, and asks in the console language', async () => {
    const fetchMock = mockRoutes([{ path: 'nodes.1', message: ADVISORY_ZH }]);
    renderPanel();
    const block = await screen.findByTestId('draft-flow-checks');
    const item = within(block).getByTestId('draft-flow-checks-item');
    expect(item.textContent).toContain('会议提醒');
    expect(item.textContent).toContain(ADVISORY_ZH);
    // No rule id, no machine name of the flow in the row.
    expect(block.textContent).not.toMatch(/flow-decision-unconditional-branch|xin_huiyi_tixing/);
    // The read that fed it stated the console's language.
    const draftCall = fetchMock.mock.calls.find(
      ([u, init]) => String(u).includes('state=draft') && (init?.headers as Record<string, string> | undefined)?.['Accept-Language'],
    );
    expect((draftCall![1]!.headers as Record<string, string>)['Accept-Language']).toBe('zh-CN');
  });

  it('reports without blocking — the Publish button stays live', async () => {
    mockRoutes([{ path: 'nodes.1', message: ADVISORY_ZH }]);
    renderPanel();
    await screen.findByTestId('draft-flow-checks');
    expect(screen.getByTestId('draft-changes-publish')).not.toBeDisabled();
  });

  it('says nothing for a flow draft whose publish has nothing to report', async () => {
    mockRoutes([]);
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('draft-changes-publish')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByTestId('draft-flow-checks')).not.toBeInTheDocument();
  });

  it('marks a publish from here as reviewed for its flight only', async () => {
    mockRoutes([{ path: 'nodes.1', message: ADVISORY_ZH }]);
    let release!: () => void;
    let seenDuringPublish: boolean | undefined;
    const onPublish = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          seenDuringPublish = werePublishChecksShown('flow', 'xin_huiyi_tixing');
          release = resolve;
        }),
    );
    renderPanel(onPublish);
    await screen.findByTestId('draft-flow-checks');
    expect(werePublishChecksShown('flow', 'xin_huiyi_tixing')).toBe(false);
    fireEvent.click(screen.getByTestId('draft-changes-publish'));
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(seenDuringPublish).toBe(true);
    release();
    await waitFor(() => expect(werePublishChecksShown('flow', 'xin_huiyi_tixing')).toBe(false));
  });

  it('CONTROL: a publish with nothing listed marks nothing', async () => {
    mockRoutes([]);
    let seenDuringPublish: boolean | undefined;
    const onPublish = vi.fn(async () => {
      seenDuringPublish = werePublishChecksShown('flow', 'xin_huiyi_tixing');
    });
    renderPanel(onPublish);
    await waitFor(() => expect(screen.getByTestId('draft-changes-publish')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 150));
    fireEvent.click(screen.getByTestId('draft-changes-publish'));
    expect(seenDuringPublish).toBe(false);
  });
});
