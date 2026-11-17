// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34818 item 1 — the pending-changes sheet reads what a flow
 * draft's publish would still say off the server's own draft read.
 *
 * Pinned: only flow drafts are read; the read states the console's language
 * (the server picks the sentence's locale from it); the server's sentences come
 * back as sent, refusals before advisories; a failed read is "no checks".
 */

import { describe, expect, it, vi } from 'vitest';
import { draftChecksOf, readDraftChecks } from './flowDraftChecks';

const ADVISORY_ZH =
  '流程“会议提醒”中的条件分支“检查日期”没有为任何一条连线（“提醒负责人”、“跳过”）设置条件，因此每次运行都会走所有连线，这个分支起不到选择作用。请为每条连线设置条件，并把其中一条设为默认分支。';

const draftRead = (diagnostics: unknown) => ({
  type: 'flow',
  name: 'xin_huiyi_tixing',
  item: { name: 'xin_huiyi_tixing', label: '会议提醒', _diagnostics: diagnostics },
});

function fetchReturning(payloadFor: (url: string) => unknown, status = 200) {
  return vi.fn(async (input: RequestInfo | URL) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payloadFor(String(input)),
  })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('draftChecksOf (objectstack#34818)', () => {
  it('projects the served warnings, keeping the server sentence and the item-relative path', () => {
    const checks = draftChecksOf(
      { type: 'flow', name: 'xin_huiyi_tixing' },
      draftRead({ valid: true, errors: [], warnings: [{ path: 'nodes.1', message: ADVISORY_ZH }] }),
    );
    expect(checks).toEqual([
      { type: 'flow', name: 'xin_huiyi_tixing', severity: 'warning', message: ADVISORY_ZH, path: 'nodes.1' },
    ]);
  });

  it('lists a refusal before an advisory', () => {
    const checks = draftChecksOf(
      { type: 'flow', name: 'f' },
      draftRead({
        valid: false,
        errors: [{ path: 'nodes.0', message: 'refused' }],
        warnings: [{ path: 'nodes.1', message: 'advised' }],
      }),
    );
    expect(checks.map((c) => [c.severity, c.message])).toEqual([
      ['error', 'refused'],
      ['warning', 'advised'],
    ]);
  });

  it('yields nothing for a body with no diagnostics, and skips a blank message', () => {
    expect(draftChecksOf({ type: 'flow', name: 'f' }, { item: { name: 'f' } })).toEqual([]);
    expect(
      draftChecksOf({ type: 'flow', name: 'f' }, draftRead({ valid: true, errors: [], warnings: [{ message: '  ' }] })),
    ).toEqual([]);
  });
});

describe('readDraftChecks (objectstack#34818)', () => {
  it('reads only the flow drafts, as drafts, in their package, stating the console language', async () => {
    const fetchImpl = fetchReturning(() =>
      draftRead({ valid: true, errors: [], warnings: [{ path: 'nodes.1', message: ADVISORY_ZH }] }),
    );
    const checks = await readDraftChecks(
      [
        { type: 'object', name: 'meeting', packageId: 'app.minutes' },
        { type: 'flow', name: 'xin_huiyi_tixing', packageId: 'app.minutes' },
      ],
      { language: 'zh-CN', fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/meta/flow/xin_huiyi_tixing?state=draft&package=app.minutes');
    expect((init.headers as Record<string, string>)['Accept-Language']).toBe('zh-CN');
    expect(checks.map((c) => c.message)).toEqual([ADVISORY_ZH]);
  });

  it('states no language when the console has none to state', async () => {
    const fetchImpl = fetchReturning(() => draftRead(undefined));
    await readDraftChecks([{ type: 'flow', name: 'f', packageId: null }], { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/meta/flow/f?state=draft');
    expect(init.headers as Record<string, string>).not.toHaveProperty('Accept-Language');
  });

  it('a failed or thrown read is "no checks", never a failure', async () => {
    expect(
      await readDraftChecks([{ type: 'flow', name: 'f', packageId: null }], {
        fetchImpl: fetchReturning(() => ({}), 500),
      }),
    ).toEqual([]);
    const throwing = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await readDraftChecks([{ type: 'flow', name: 'f', packageId: null }], { fetchImpl: throwing })).toEqual([]);
  });
});
