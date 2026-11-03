// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#29617, ADR-0141 D5 / ADR-0146 D2] A `.custom` pair exported by
// `GET /packages/:id/export` reinstalls, through
// `POST /api/v1/marketplace/install-local`, as the pair it was: under the
// namespace it was installed with, depending on its base, its override
// admitted.
//
// ## What was measured before the fix
//
// The export answered the pair's items and `id`, `name`, `version`, and
// nothing of the two install-manifest keys its registry row holds. So the
// reinstall knew no namespace (the install door derives one from the id:
// `custom`) and no base edge, and the base edge is what orders the pair after
// its base (ADR-0141 D5) and what admits the pair's `overrides` declarations
// at the managed install (ADR-0146 D2).
//
// ## What this file pins, over two showcase boots
//
//   1. source: the ensure door creates the showcase's pair, a dashboard
//      override is published into it, and the pair's export carries the
//      `namespace` and `dependencies` its registry row declares (the row is
//      the control);
//   2. target: a fresh showcase installs that export through install-local,
//      200, and the reinstalled pair's registry row declares the same
//      namespace and the same edge to the showcase, its override carried
//      with its `overrides` block.
//
// Boots fixture stacks of its own (the install-local plugin mounted on the
// target), so it stays out of `SHARED_SHOWCASE`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { bootShowcase } from './showcase-boot.js';
import { declaredOverride, ensurePair, inPair, pairOf } from './customization-pair.js';

const SHOWCASE = 'com.example.showcase';
const PAIR = pairOf(SHOWCASE);
const ROUTE = '/marketplace/install-local';
const DASHBOARD = 'showcase_revenue_pulse';
const EDITED = 'Revenue pulse (customized)';

type Answer = { status: number; body: any };

async function call(stack: VerifyStack, token: string, method: string, path: string, body?: unknown): Promise<Answer> {
  const res = await stack.apiAs(token, method, path, body);
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** The manifest a `GET /packages/:id` answer carries for the package's registry row. */
const rowManifest = (answer: Answer): Record<string, any> | undefined =>
  answer.body?.data?.manifest ?? answer.body?.data?.package?.manifest;

describe('dogfood: a `.custom` pair\'s export reinstalls under its own namespace, depending on its base', () => {
  let storageDir: string;
  let sourceRow: Answer;
  let published: Answer;
  let exported: Answer;
  let installed: Answer;
  let targetRow: Answer;

  beforeAll(async () => {
    const source = await bootShowcase();
    try {
      const token = await source.signIn();
      await ensurePair(source, token, SHOWCASE);
      sourceRow = await call(source, token, 'GET', `/packages/${PAIR}`);
      const saved = await call(source, token, 'PUT', inPair(`/meta/dashboard/${DASHBOARD}?mode=draft`, SHOWCASE),
        declaredOverride({ name: DASHBOARD, label: EDITED, columns: 12, widgets: [] }, SHOWCASE, '0.1.0'));
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      published = await call(source, token, 'POST', `/packages/${PAIR}/publish-drafts`, {});
      exported = await call(source, token, 'GET', `/packages/${PAIR}/export`);
    } finally {
      await source.stop();
    }

    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-export-reinstall-pair-'));
    const target = await bootShowcase({
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    try {
      const token = await target.signIn();
      installed = await call(target, token, 'POST', ROUTE, { manifest: exported.body?.data });
      targetRow = await call(target, token, 'GET', `/packages/${PAIR}`);
    } finally {
      await target.stop();
    }
  }, 600_000);

  afterAll(() => {
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('source: the pair\'s export carries the namespace and the base edge its registry row declares', () => {
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(sourceRow.status, JSON.stringify(sourceRow.body)).toBe(200);
    // CONTROL: the row the export reads declares both.
    const row = rowManifest(sourceRow);
    expect(row?.namespace, JSON.stringify(sourceRow.body)).toBe('showcase_custom');
    expect(Object.keys(row?.dependencies ?? {})).toEqual([SHOWCASE]);

    expect(exported.status, JSON.stringify(exported.body)).toBe(200);
    const manifest = exported.body?.data;
    expect(manifest?.namespace).toBe(row?.namespace);
    expect(manifest?.dependencies).toEqual(row?.dependencies);
    expect((manifest?.dashboards ?? []).map((d: any) => [d.name, d.label, d.overrides?.package]))
      .toEqual([[DASHBOARD, EDITED, SHOWCASE]]);
  });

  it('target: install-local reinstalls the export, 200, with its override admitted', () => {
    expect(installed.status, JSON.stringify(installed.body)).toBe(200);
    expect(installed.body?.data?.manifestId).toBe(PAIR);
  });

  it('target: the reinstalled pair declares the namespace it was exported with and its edge to the showcase', () => {
    expect(targetRow.status, JSON.stringify(targetRow.body)).toBe(200);
    const row = rowManifest(targetRow);
    expect(row?.namespace, JSON.stringify(targetRow.body)).toBe('showcase_custom');
    expect(row?.dependencies).toEqual(rowManifest(sourceRow)?.dependencies);
  });
});
