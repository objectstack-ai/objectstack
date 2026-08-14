// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7163] A nested plugin EXPANDS an aggregated view container, exactly as a
 * manifest does.
 *
 * ## What was broken
 *
 * "Object has-many View" (ADR-0017 §2, §3.2) makes the loader **dual-read**: an
 * aggregated `defineView` container is registered under the bare `<object>` key
 * for back-compatible reads AND expanded into independent `ViewItem`s under
 * `<object>.<viewKey>`. Only the expanded items carry `viewKind`, and
 * `getViewsByObject()` filters on exactly that — so the expanded layer, not the
 * container, is what `GET /meta/view?object=`, the runtime view switcher and
 * Studio's package attribution actually read.
 *
 * `engine.ts` reaches the registration seam from two entry points. #7049 hoisted
 * the shared `METADATA_ARRAY_KEYS` so both seams ENUMERATE `views`, but only the
 * manifest seam's loop body expanded:
 *
 *   via manifest      → ['account', 'account.all_accounts', 'account.form']
 *   via nested plugin → ['account']
 *
 * No refusal and no diagnostic — a package shipping its views through
 * `manifest.plugins[]` simply had no views as far as every reader of the
 * expanded layer was concerned.
 *
 * ## Why the nested seam gained the expansion, rather than the manifest seam
 * ## losing it
 *
 * The divergence had two coherent readings and the card deliberately picked
 * neither. Measured on `main` before choosing:
 *
 *  - ADR-0017 §2 states the dual-read as a property of "the loader" at load
 *    time, not of one entry point, and §3.2 spells out that it registers BOTH.
 *  - The OTHER loader agrees with the manifest seam: `MetadataPlugin`'s artifact
 *    /HMR path expands too (`packages/metadata/src/plugin.ts`), which is why
 *    the shared implementation was pushed down into `@objectstack/spec` in the
 *    first place — "so the two loaders cannot drift" (`ui/view.zod.ts`).
 *  - Every authored stack in the tree ships `views` at manifest TOP level
 *    (~51 files: `examples/app-crm`, `app-todo`, `app-showcase`,
 *    `packages/qa/downstream-contract`, …). Removing the manifest seam's
 *    expansion would take the view switcher away from all of them.
 *  - No in-tree package ships `views` through a nested plugin — swept across
 *    `examples/`, `apps/` and `packages/`, zero hits. So the seam that gains
 *    behaviour here breaks nobody in-tree, while the seam that would lose it
 *    breaks everybody.
 *
 * One direction is load-bearing for real consumers and the other is not, so the
 * nested seam catches up — the same direction #7049 took for the enumeration.
 *
 * Refs: #7163, #7049 (the enumeration half + the exclusion row this retires),
 * ADR-0017 (Object has-many View), ADR-0010 (provenance envelope).
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine';

const PKG = 'com.acme.sales';

/**
 * The card's measured fixture: one aggregated container for `account`, with a
 * named list view and a default form. Shaped like `examples/app-crm`'s view
 * modules — the container carries no top-level `name`, so its registry key is
 * resolved from `list.data.object` (ADR-0017 §3.1: `ViewSchema` has no `name`).
 *
 * The default `list` deliberately RESTATES `listViews.all_accounts` verbatim —
 * the common "default == the named view" authoring pattern the expander
 * collapses by structural signature. That is what makes the expansion exactly
 * the card's measured `['account', 'account.all_accounts', 'account.form']`
 * rather than carrying a separate `account.default`.
 */
function accountContainer() {
  const allAccounts = {
    label: 'All Accounts',
    type: 'grid',
    data: { provider: 'object', object: 'account' },
    columns: [{ field: 'name' }],
  };
  return {
    list: { ...allAccounts },
    listViews: { all_accounts: { ...allAccounts } },
    form: {
      type: 'simple',
      data: { provider: 'object', object: 'account' },
      sections: [{ label: 'Info', fields: [{ field: 'name' }] }],
    },
  };
}

/** The same container declared directly on the manifest — the reference path. */
function viaManifest() {
  return { id: PKG, name: 'sales', views: [accountContainer()] };
}

/** …and arriving ONLY through a nested plugin (`manifest.plugins[]`). */
function viaNestedPlugin() {
  return { id: PKG, name: 'sales', plugins: [{ name: 'sales-nested', views: [accountContainer()] }] };
}

// [#8378] The `content ?? item` unwrap this mirrored is retired — a no-op on a
// real engine, whose `registerMetadataCollections` registers items as-is.
function viewItems(engine: ObjectQL): any[] {
  return (engine.registry.listItems<any>('view') ?? [])
    .filter(Boolean);
}

function viewNames(engine: ObjectQL): string[] {
  return viewItems(engine).map((v: any) => v.name).sort();
}

function boot(manifest: unknown): ObjectQL {
  const engine = new ObjectQL();
  engine.registerApp(manifest as any);
  return engine;
}

describe('aggregated view container — the two seams register the SAME thing (#7163)', () => {
  it('expands a nested plugin\'s container into per-view items', () => {
    // Before #7163 this was exactly `['account']` — the container alone.
    expect(viewNames(boot(viaNestedPlugin()))).toEqual([
      'account',
      'account.all_accounts',
      'account.form',
    ]);
  });

  it('registers identically whether the container arrives via manifest or nested plugin', () => {
    // The parity pin — the card's whole point. Stated as manifest-vs-nested
    // equality rather than against a literal, so a change to the expansion
    // rules moves BOTH seams or fails here.
    expect(viewNames(boot(viaNestedPlugin()))).toEqual(viewNames(boot(viaManifest())));
  });

  it('keeps the bare <object> container registered alongside the expansion (ADR-0017 dual-read)', () => {
    // Back-compat half: expanding must not replace the container. Both seams.
    for (const manifest of [viaManifest(), viaNestedPlugin()]) {
      const names = viewNames(boot(manifest));
      expect(names).toContain('account');
      expect(names.filter((n) => n.startsWith('account.'))).not.toHaveLength(0);
    }
  });
});

describe('the expanded per-view identities a nested plugin now produces (#7163)', () => {
  const items = viewItems(boot(viaNestedPlugin()));
  const byName = Object.fromEntries(items.map((v: any) => [v.name, v]));

  it('gives every expanded item the `viewKind` `getViewsByObject()` filters on', () => {
    // This is the property the whole card turns on: the container carries NO
    // `viewKind`, so a registry holding only the container answers empty to
    // `getViewsByObject()` / `GET /meta/view?object=` — silently.
    expect(byName['account'].viewKind).toBeUndefined();
    expect(byName['account.all_accounts'].viewKind).toBe('list');
    expect(byName['account.form'].viewKind).toBe('form');

    const readable = items.filter((v: any) => v.viewKind && v.object === 'account');
    expect(readable.map((v: any) => v.name).sort()).toEqual([
      'account.all_accounts',
      'account.form',
    ]);
  });

  it('binds each expanded item to its object and stamps scope=package', () => {
    for (const name of ['account.all_accounts', 'account.form']) {
      expect(byName[name].object).toBe('account');
      expect(byName[name].scope).toBe('package');
    }
  });

  it('carries the container\'s config through to the expanded item', () => {
    expect(byName['account.all_accounts'].config.type).toBe('grid');
    expect(byName['account.all_accounts'].label).toBe('All Accounts');
    expect(byName['account.all_accounts'].config.columns).toEqual([{ field: 'name' }]);
    expect(byName['account.form'].config.sections[0].label).toBe('Info');
    // The named entry absorbed the structurally identical default `list`, so it
    // is the declared default of its family.
    expect(byName['account.all_accounts'].isDefault).toBe(true);
  });

  it('stamps ADR-0010 provenance on the expanded items, owned by the PARENT package', () => {
    // A nested plugin contributes under its parent's ownership — the parent
    // already claimed the namespace (same rule #7049 pinned for the four
    // collections). The expansion must not bypass that stamp.
    for (const name of ['account', 'account.all_accounts', 'account.form']) {
      expect(byName[name]._packageId, `'${name}' reached the registry unstamped`).toBe(PKG);
      expect(byName[name]._provenance).toBe('package');
    }
  });

  it('produces the same expanded identities the manifest seam produces', () => {
    const fromManifest = Object.fromEntries(
      viewItems(boot(viaManifest())).map((v: any) => [v.name, v]),
    );
    for (const name of ['account.all_accounts', 'account.form']) {
      expect(byName[name].viewKind).toBe(fromManifest[name].viewKind);
      expect(byName[name].object).toBe(fromManifest[name].object);
      expect(byName[name].isDefault).toBe(fromManifest[name].isDefault);
      expect(byName[name].order).toBe(fromManifest[name].order);
      expect(byName[name].config).toEqual(fromManifest[name].config);
    }
  });
});

describe('a NON-container `views:` entry is REFUSED by both seams (#5320)', () => {
  /**
   * [#5320] REPLACED WHOLESALE, per the fork ruling's fixture disposition.
   * The block this replaces was #7163's control: it PINNED that a standalone
   * ViewItem in `views:` "registers as-is, through both seams" — i.e. it
   * pinned exactly the undeclared runtime-wider acceptance this card removes
   * (the stack vocabulary was always container-only, `stack.zod.ts:views`).
   * Keeping it would have kept a green assertion over a deleted behaviour;
   * loosening it would have judged nothing. It is now the rejection pin:
   * both seams refuse the entry with the ADR-0112 envelope (`code` + `status`)
   * and the wrap-it prescription, and the declared travel route for
   * machine-assembled non-container artifacts is the `viewItems:` channel.
   */
  const viewItem = {
    name: 'account.hot',
    object: 'account',
    viewKind: 'list',
    config: { type: 'grid', columns: [{ field: 'name' }] },
  };

  /** Envelope-first assertion: `code` AND `status`, never a bare toThrow. */
  function expectRefusal(manifest: unknown) {
    let thrown: (Error & { code?: string; status?: number }) | undefined;
    try {
      boot(manifest);
    } catch (e) {
      thrown = e as Error & { code?: string; status?: number };
    }
    expect(thrown, 'registration must refuse, not accept').toBeTruthy();
    expect(thrown!.code).toBe('INVALID_METADATA');
    expect(thrown!.status).toBe(422);
    expect(thrown!.message).toMatch(/containers only/i);
    expect(thrown!.message).toContain('defineView');
    return thrown!;
  }

  it('refuses a standalone ViewItem in `views:` from the manifest seam, envelope + prescription', () => {
    const err = expectRefusal({ id: PKG, name: 'sales', views: [viewItem] });
    // The refusal names the entry, so the author fixes the right view.
    expect(err.message).toContain('account.hot');
  });

  it('refuses identically from the nested-plugin seam (one body, one verdict — #7163 kept)', () => {
    expectRefusal({ id: PKG, name: 'sales', plugins: [{ name: 'p', views: [viewItem] }] });
  });

  it('refuses a flattened overlay in `views:` too (inline config, no container slot)', () => {
    expectRefusal({
      id: PKG,
      name: 'sales',
      views: [{ name: 'account.default', object: 'account', viewKind: 'list', type: 'grid', columns: [{ field: 'name' }] }],
    });
  });

  it('accepts the SAME artifact through the declared `viewItems:` channel', () => {
    const engine = boot({ id: PKG, name: 'sales', viewItems: [viewItem] });
    expect(viewNames(engine)).toEqual(['account.hot']);
    const stored = viewItems(engine).find((v: any) => v.name === 'account.hot');
    expect(stored.viewKind).toBe('list');
    expect(stored.object).toBe('account');
  });

  it('refuses an undeclared bag in `viewItems:` with the envelope (strict channel, no passthrough)', () => {
    let thrown: (Error & { code?: string; status?: number }) | undefined;
    try {
      boot({ id: PKG, name: 'sales', viewItems: [{ name: 'account.junk', nope: 1 }] });
    } catch (e) {
      thrown = e as Error & { code?: string; status?: number };
    }
    expect(thrown, 'the viewItems channel must refuse an undeclared bag').toBeTruthy();
    expect(thrown!.code).toBe('INVALID_METADATA');
    expect(thrown!.status).toBe(422);
  });

  it('leaves a container-free manifest with no view items at all', () => {
    expect(viewNames(boot({ id: PKG, name: 'sales' }))).toEqual([]);
    expect(viewNames(boot({ id: PKG, name: 'sales', plugins: [{ name: 'p' }] }))).toEqual([]);
  });
});
