// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7049] A nested plugin registers the SAME collections a manifest does.
 *
 * `engine.ts` reaches the ADR-0010 provenance seam — `registerItem` →
 * `applyProtection`, the only place `_packageId` / `_provenance` are stamped —
 * from two entry points: a manifest (`registerApp()`) and a nested plugin
 * (`registerPlugin()`, reached via `manifest.plugins[]`). Each used to carry its
 * OWN copy of the collection list, and the two copies had drifted:
 *
 *   `jobs`, `emailTemplates`, `tools`, `skills` — registered from a manifest,
 *   NOT registered from a nested plugin.
 *
 * A package shipping any of the four from a nested plugin therefore registered
 * NOTHING: no refusal, no diagnostic, no provenance stamp. The collection simply
 * was not in the registry after boot, and every reader of it — `/meta/job`,
 * `/meta/email_template`, the AI protocol's tool/skill resolution, the email
 * plugin's `sys_email_template` materializer (#4509) — answered empty for a
 * package that had declared it.
 *
 * `capabilities` hit this exact divergence and was patched into the nested copy
 * BY HAND (#5870); nobody then diffed the rest of the two lists, which is how
 * the remaining four survived. So the fix is not four more names: the two copies
 * are now ONE `METADATA_ARRAY_KEYS` both seams read, and the last suite below
 * pins that property directly — a future divergence has to get past a test that
 * compares the two seams' output rather than past a reviewer diffing two lists.
 *
 * Refs: #7049, #6242 (the enumeration sweep), #5870 (the `capabilities`
 * precedent), PR #7032 (the measurement + the gate waiver row this removes),
 * ADR-0010 (provenance envelope).
 */

import { describe, it, expect } from 'vitest';
import { pluralToSingular } from '@objectstack/spec/shared';
import { ObjectQL } from './engine';

const PKG = 'com.acme.billing';

/**
 * The four collections whose two-copy divergence this card closes, each with the
 * singular registry type its readers ask for. Both halves matter: membership in
 * the shared key list registers the item, and the plural→singular mapping is
 * what decides whether it lands in the store anything reads (the same pairing
 * `engine-capability-provenance.test.ts` pins for the security collections).
 */
const DIVERGED_COLLECTIONS: ReadonlyArray<readonly [plural: string, singular: string]> = [
  ['jobs', 'job'],
  ['emailTemplates', 'email_template'],
  ['tools', 'tool'],
  ['skills', 'skill'],
];

/** One authored item per collection, with NO author-side package attribution. */
function itemFor(plural: string): Record<string, unknown> {
  switch (plural) {
    case 'jobs':
      return { name: 'nightly_invoice', label: 'Nightly Invoice', schedule: '0 2 * * *' };
    case 'emailTemplates':
      return { name: 'invoice_ready', subject: 'Your invoice is ready', body: 'Hello {{name}}' };
    case 'tools':
      return { name: 'refund_lookup', label: 'Refund Lookup', description: 'Find a refund by id.' };
    case 'skills':
      return { name: 'dunning', label: 'Dunning', description: 'Chase overdue invoices.' };
    default:
      throw new Error(`no fixture for '${plural}'`);
  }
}

/** A manifest whose artifacts arrive ONLY through a nested plugin. */
function manifestWithNestedPlugin(collections: readonly string[]) {
  const plugin: Record<string, unknown> = { name: 'billing-nested' };
  for (const plural of collections) plugin[plural] = [itemFor(plural)];
  return { id: PKG, name: 'billing', plugins: [plugin] };
}

/** The same artifacts declared directly on the manifest — the reference path. */
function manifestDirect(collections: readonly string[]) {
  const manifest: Record<string, unknown> = { id: PKG, name: 'billing' };
  for (const plural of collections) manifest[plural] = [itemFor(plural)];
  return manifest;
}

// [#8378] Both helpers mirrored the plugin readers' `content ?? item` unwrap,
// which has been retired: `registerMetadataCollections` registers each
// collection element as-is, so the unwrap was a no-op on this real engine.
function registeredNames(engine: ObjectQL, type: string): string[] {
  return (engine.registry.listItems<any>(type) ?? [])
    .filter(Boolean)
    .map((i: any) => i.name);
}

function registeredItem(engine: ObjectQL, type: string): any {
  return (engine.registry.listItems<any>(type) ?? []).filter(Boolean)[0];
}

describe('registerPlugin — the four collections a nested plugin used to drop (#7049)', () => {
  for (const [plural, singular] of DIVERGED_COLLECTIONS) {
    it(`registers \`${plural}\` shipped by a nested plugin under '${singular}'`, () => {
      const engine = new ObjectQL();
      engine.registerApp(manifestWithNestedPlugin([plural]));

      // Before #7049 this list was EMPTY — the silent no-registration.
      expect(registeredNames(engine, singular)).toEqual([itemFor(plural).name]);
    });

    it(`stamps ADR-0010 provenance on a nested-plugin \`${plural}\` item`, () => {
      const engine = new ObjectQL();
      engine.registerApp(manifestWithNestedPlugin([plural]));

      const item = registeredItem(engine, singular);
      expect(item, `nothing registered under '${singular}'`).toBeDefined();
      // A nested plugin contributes UNDER its parent package's ownership: the
      // parent already claimed the namespace, so `ownerId` is the parent id.
      expect(item._packageId, `'${singular}' reached the registry unstamped`).toBe(PKG);
      expect(item._provenance).toBe('package');
      // …and the stamp really is the registry's: nothing authored it.
      expect(item.packageId).toBeUndefined();
    });
  }

  it('registers all four at once, exactly as a manifest does', () => {
    const plurals = DIVERGED_COLLECTIONS.map(([p]) => p);

    const nested = new ObjectQL();
    nested.registerApp(manifestWithNestedPlugin(plurals));
    const direct = new ObjectQL();
    direct.registerApp(manifestDirect(plurals));

    for (const [plural, singular] of DIVERGED_COLLECTIONS) {
      expect(registeredNames(nested, singular), `'${plural}' missing from the nested seam`)
        .toEqual(registeredNames(direct, singular));
      expect(registeredItem(nested, singular)._packageId)
        .toBe(registeredItem(direct, singular)._packageId);
    }
  });

  it('maps each collection to the singular type its readers ask for', () => {
    // Membership in the key list is only half the contract: an item registered
    // under the wrong singular lands in a store nobody reads.
    for (const [plural, singular] of DIVERGED_COLLECTIONS) {
      expect(pluralToSingular(plural), `${plural} must register as '${singular}'`).toBe(singular);
    }
  });
});

describe('the two registration seams enumerate ONE collection list (#7049)', () => {
  /**
   * The root cause this card names is not the four missing names — it is that
   * the two seams had two hand-maintained lists and nothing compared them. This
   * suite is that comparison, stated as a property over EVERY collection the
   * engine registers rather than over the four that happened to diverge: ship
   * one item of a collection through a manifest and the same item through a
   * nested plugin, and the two registries must agree. A key added to one seam
   * only cannot pass it, whatever the two lists look like.
   *
   * The collections excluded below are excluded for measured reasons, not to
   * make the test pass — see each entry.
   */
  const NOT_COMPARABLE: ReadonlyArray<readonly [key: string, why: string]> = [
    // `views` used to sit here: the manifest seam expanded an aggregated
    // container into per-view items (ADR-0017) and the nested seam did not — a
    // LOOP-BODY difference rather than an enumeration one, so this card filed it
    // as #7163 instead of folding it in. #7163 closed it by sharing the body
    // (`registerMetadataCollections()`), so `views` is comparable now and is
    // back in `CANDIDATES` below; the aggregated-container half of its parity is
    // pinned in `engine-nested-plugin-view-expansion.test.ts`.
    //
    // Retired kinds the loop still iterates; the schema rejects the keys long
    // before either seam runs, so a fixture cannot exercise them (the gate
    // carries them as an `extra` waiver row for the same reason).
    ['workflows', 'ADR-0019 retired'],
    ['approvals', 'ADR-0020 retired'],
    ['roles', 'ADR-0090 retired'],
    ['profiles', 'ADR-0088 retired'],
    ['policies', 'ADR-0088 retired'],
    ['ragPipelines', 'not declared by ObjectStackDefinitionSchema'],
  ];

  const excluded = new Set(NOT_COMPARABLE.map(([k]) => k));

  /**
   * Read the shared enumeration back off the engine by probing it: for each
   * candidate collection, does a one-item manifest register anything? This asks
   * the running engine rather than importing a constant, so the test measures
   * behaviour and not the same literal the implementation reads.
   */
  const CANDIDATES = [
    'actions', 'views', 'pages', 'dashboards', 'reports', 'datasets', 'themes',
    'flows', 'webhooks', 'jobs',
    'permissions', 'capabilities', 'sharingRules',
    'agents', 'tools', 'skills', 'apis',
    'hooks', 'mappings', 'analyticsCubes', 'connectors',
    'emailTemplates', 'docs', 'books',
  ].filter((k) => !excluded.has(k));

  it.each(CANDIDATES)('registers `%s` identically from a manifest and from a nested plugin', (plural) => {
    const singular = pluralToSingular(plural);
    const item = { name: `probe_${plural}`, label: `Probe ${plural}` };

    const direct = new ObjectQL();
    direct.registerApp({ id: PKG, name: 'billing', [plural]: [item] });
    const nested = new ObjectQL();
    nested.registerApp({ id: PKG, name: 'billing', plugins: [{ name: 'p', [plural]: [item] }] });

    const fromManifest = registeredNames(direct, singular);
    const fromPlugin = registeredNames(nested, singular);

    // The property, in both directions: whatever one seam registers, the other
    // registers. A collection added to one list only fails here.
    expect(fromPlugin, `'${plural}' diverges between the two registration seams`).toEqual(fromManifest);
    if (fromManifest.length > 0) {
      expect(registeredItem(nested, singular)._packageId).toBe(PKG);
      expect(registeredItem(nested, singular)._provenance).toBe('package');
    }
  });

  it('records why each excluded collection is not comparable, rather than dropping it silently', () => {
    for (const [, why] of NOT_COMPARABLE) expect(why.length).toBeGreaterThan(0);
    // `views` left this list in #7163 — the only entry that was ever excluded
    // for a BEHAVIOUR difference rather than a retired-kind one. Every survivor
    // is a kind the schema rejects before either seam runs.
    expect(NOT_COMPARABLE.map(([k]) => k)).toEqual([
      'workflows', 'approvals', 'roles', 'profiles', 'policies', 'ragPipelines',
    ]);
    expect(NOT_COMPARABLE.map(([k]) => k)).not.toContain('views');
  });
});
