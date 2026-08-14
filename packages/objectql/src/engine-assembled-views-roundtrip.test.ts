// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5320/#8070] The export→import round trip survives END TO END through the
 * declared channels — the fork's acceptance probe, inverted.
 *
 * The 2026-08-12 fork measured (by execution) that the platform's own package
 * export emitted `views:` entries the stack vocabulary refuses — 2 of 3 entries
 * in the minimal single-container case — and the round trip survived only
 * through the registration loop's undeclared wider acceptance. With the ruling
 * landed (B vocabulary + A's re-aggregation + the tighten), the SAME flows must
 * survive through the declared channels instead:
 *
 *   register → read back (what `GET /packages/:id/export` reads) → partition
 *   (`partitionAssembledViewArtifacts`, the assembler's half) → re-import
 *   through `registerApp` → every view artifact is registered again.
 *
 * This is the executed probe, not a grep: it runs the real registration loop
 * on both ends and the real partition in the middle.
 */

import { describe, it, expect } from 'vitest';
import { partitionAssembledViewArtifacts } from '@objectstack/spec';
import { ObjectQL } from './engine';

const PKG = 'com.acme.sales';

/** Minimal schema-valid container — the fork probe's fixture: default list +
 *  default form → dual-read registers 3 registry items. */
function accountContainer() {
  return {
    name: 'account',
    object: 'account',
    list: { type: 'grid', data: { provider: 'object', object: 'account' }, columns: [{ field: 'name' }] },
    form: { type: 'simple', data: { provider: 'object', object: 'account' }, sections: [{ label: 'Info', fields: [{ field: 'name' }] }] },
  };
}

/** A tenant-authored standalone ViewItem — legal branch 1 of the `view`
 *  metadata vocabulary; has NO container to re-aggregate from. */
const STANDALONE = {
  name: 'account.hot',
  object: 'account',
  viewKind: 'list',
  config: { type: 'grid', columns: [{ field: 'name' }] },
};

/** What the export path's `clean()` does: strip provenance decorations. */
function clean(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if (k.startsWith('_')) continue;
    out[k] = v;
  }
  return out;
}

function viewNames(engine: ObjectQL): string[] {
  return (engine.registry.listItems<any>('view') ?? []).filter(Boolean).map((v: any) => v.name).sort();
}

describe('export→import round trip through the declared channels (#5320/#8070)', () => {
  it('the minimal single-container package survives end to end — all entries land', () => {
    // ── source environment ──
    const source = new ObjectQL();
    source.registerApp({ id: PKG, name: 'sales', views: [accountContainer()] });
    // Tenant authors a standalone ViewItem through the metadata door.
    source.registry.registerItem('view', { ...STANDALONE }, 'name' as any, PKG);

    const sourceNames = viewNames(source);
    expect(sourceNames).toEqual(['account', 'account.default', 'account.form', 'account.hot']);

    // ── export assembly (what assemblePackageManifest now does for views) ──
    const stored = (source.registry.listItems<any>('view') ?? []).filter(Boolean).map(clean);
    const { views, viewItems, folded } = partitionAssembledViewArtifacts(stored);

    // Predicted directions, stated before running (fork discipline):
    // the container travels; its 2 expanded items FOLD (the import side
    // re-derives them); the standalone travels in viewItems.
    expect(views.map((v) => v.name)).toEqual(['account']);
    expect(folded.sort()).toEqual(['account.default', 'account.form']);
    expect(viewItems.map((v) => v.name)).toEqual(['account.hot']);

    // ── import into a fresh environment ──
    const target = new ObjectQL();
    target.registerApp({ id: PKG, name: 'sales', views, viewItems });

    // END TO END: every view artifact of the source is registered in the target.
    expect(viewNames(target)).toEqual(sourceNames);
  });

  it('a tenant-authored standalone ViewItem survives export→import alone', () => {
    const source = new ObjectQL();
    source.registerApp({ id: PKG, name: 'sales' });
    source.registry.registerItem('view', { ...STANDALONE }, 'name' as any, PKG);

    const stored = (source.registry.listItems<any>('view') ?? []).filter(Boolean).map(clean);
    const { views, viewItems } = partitionAssembledViewArtifacts(stored);
    expect(views).toEqual([]);
    expect(viewItems.map((v) => v.name)).toEqual(['account.hot']);

    const target = new ObjectQL();
    target.registerApp({ id: PKG, name: 'sales', viewItems });
    expect(viewNames(target)).toEqual(['account.hot']);
    const round = (target.registry.listItems<any>('view') ?? []).find((v: any) => v?.name === 'account.hot');
    expect(round.viewKind).toBe('list');
    expect(round.config).toEqual(STANDALONE.config);
  });
});
