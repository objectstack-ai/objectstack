// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from './registry.js';

/**
 * #6808 — `SchemaRegistry.unregisterObject`, the NAME-addressed removal verb.
 *
 * Until it existed, the only way an object left `objectContributors` was
 * `unregisterObjectsByPackage` — addressed by PACKAGE, which is the right verb
 * for an uninstall and the wrong one for a single delete. The gap was not
 * academic: `deleteMetaItem`'s registry heal walks the generic `metadata` map
 * only, so a deleted `object` kept being served by `getObject` (and therefore
 * by `getItem('object', …)`, which special-cases back to it) for the life of
 * the process — the surface the data plane dispatches on. The protocol half is
 * pinned in `protocol-delete-object-registry-heal.test.ts`; this file pins the
 * verb itself.
 *
 * The guard it carries is ADR-0029's, borrowed rather than re-invented: exactly
 * one package owns an object and others may only extend it, so removing an
 * owner out from under a live extender leaves contributions that resolve to
 * nothing. `unregisterObjectsByPackage` already encodes that judgement (refuse,
 * name the extenders, `force` overrides); this verb mirrors it with the address
 * changed from package to name — and needs no new bookkeeping to do it, because
 * the owner and the extenders are both already in the contributor list.
 */

const quiet = () => {
  const r = new SchemaRegistry({ multiTenant: false });
  (r as any).logLevel = 'silent';
  return r;
};

const objectBody = (name: string, field = 'name') => ({
  name,
  label: name,
  fields: { [field]: { name: field, type: 'text', label: field } },
}) as any;

describe('#6808 — SchemaRegistry.unregisterObject', () => {
  it('removes an owned object from BOTH object exits, and reports it', () => {
    const r = quiet();
    r.registerObject(objectBody('myapp_invoice'), 'app.myapp');
    expect(r.getObject('myapp_invoice')).toBeDefined();
    expect(r.getItem('object', 'myapp_invoice')).toBeDefined();

    expect(r.unregisterObject('myapp_invoice')).toBe(true);

    expect(r.getObject('myapp_invoice')).toBeUndefined();
    // `getItem` special-cases `object` straight back to `getObject`, which is
    // exactly why the listing map looked clean while dispatch did not.
    expect(r.getItem('object', 'myapp_invoice')).toBeUndefined();
    expect(r.getAllObjects().map((o: any) => o.name)).not.toContain('myapp_invoice');
    expect(r.getObjectContributors('myapp_invoice')).toEqual([]);
    expect(r.getObjectOwner('myapp_invoice')).toBeUndefined();
  });

  it('is idempotent and answers `false` for a name that was never registered', () => {
    const r = quiet();
    r.registerObject(objectBody('myapp_invoice'), 'app.myapp');

    expect(r.unregisterObject('myapp_invoice')).toBe(true);
    expect(r.unregisterObject('myapp_invoice')).toBe(false);
    expect(r.unregisterObject('never_existed')).toBe(false);
  });

  /**
   * The merged-object cache is populated by `resolveObject` on the way in, so a
   * removal that forgot to invalidate it would keep answering for a name with
   * no contributors at all. Read the object FIRST so the cache is warm, then
   * remove — the only ordering that can catch it.
   */
  it('invalidates the merged-object cache, so a warm read cannot outlive the removal', () => {
    const r = quiet();
    r.registerObject(objectBody('myapp_invoice'), 'app.myapp');
    expect(r.getObject('myapp_invoice')).toBeDefined(); // warms the cache

    r.unregisterObject('myapp_invoice');

    expect(r.getObject('myapp_invoice')).toBeUndefined();
    expect(r.resolveObject('myapp_invoice')).toBeUndefined();
  });

  /**
   * `objectRevision` is what registry-DERIVED caches key on (the engine's
   * roll-up summary index). A removal that leaves it still would let a consumer
   * keep an index built while the object existed.
   */
  it('bumps objectRevision so registry-derived caches learn the set moved', () => {
    const r = quiet();
    r.registerObject(objectBody('myapp_invoice'), 'app.myapp');
    const before = r.objectRevision;

    r.unregisterObject('myapp_invoice');

    expect(r.objectRevision).toBeGreaterThan(before);
    // A no-op removal changes nothing — including the revision.
    const after = r.objectRevision;
    r.unregisterObject('myapp_invoice');
    expect(r.objectRevision).toBe(after);
  });

  describe('ADR-0029 — the extender guard', () => {
    it('REFUSES an owner another package still extends, naming the extender', () => {
      const r = quiet();
      r.registerObject(objectBody('myapp_invoice'), 'app.myapp');
      r.registerObject(objectBody('myapp_invoice', 'note'), 'app.addon', undefined, 'extend');

      expect(() => r.unregisterObject('myapp_invoice')).toThrowError(/app\.addon/);
      // The refusal must LEAVE the object intact — a guard that throws after
      // mutating is worse than no guard.
      expect(r.getObject('myapp_invoice')).toBeDefined();
      expect(r.getObjectOwner('myapp_invoice')?.packageId).toBe('app.myapp');
      expect(r.getObjectContributors('myapp_invoice')).toHaveLength(2);
    });

    it('the refusal names the OBJECT and tells the caller what to do first', () => {
      const r = quiet();
      r.registerObject(objectBody('myapp_invoice'), 'app.myapp');
      r.registerObject(objectBody('myapp_invoice', 'note'), 'app.addon', undefined, 'extend');
      r.registerObject(objectBody('myapp_invoice', 'tag'), 'app.tags', undefined, 'extend');

      const err = (() => { try { r.unregisterObject('myapp_invoice'); return null; } catch (e) { return e as Error; } })();

      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain('myapp_invoice');
      // EVERY extender is named, not just the first — the same shape
      // `unregisterObjectsByPackage` reports for an uninstall.
      expect(err!.message).toContain('app.addon');
      expect(err!.message).toContain('app.tags');
      expect(err!.message).toContain('Unregister the extenders first');
    });

    it('succeeds once the extender is gone — the guard is a guard, not a refusal', () => {
      const r = quiet();
      r.registerObject(objectBody('myapp_invoice'), 'app.myapp');
      r.registerObject(objectBody('myapp_invoice', 'note'), 'app.addon', undefined, 'extend');
      r.unregisterObjectsByPackage('app.addon');

      expect(r.unregisterObject('myapp_invoice')).toBe(true);
      expect(r.getObject('myapp_invoice')).toBeUndefined();
    });

    /**
     * "Other" means "not the owner's package" — the same relation the sibling
     * verb expresses as "not the package being uninstalled". An extension the
     * OWNER contributed goes away with the object it extends, exactly as it
     * would on an uninstall of that package.
     */
    it('an extension from the OWNER\'s own package does not block the removal', () => {
      const r = quiet();
      r.registerObject(objectBody('myapp_invoice'), 'app.myapp');
      r.registerObject(objectBody('myapp_invoice', 'note'), 'app.myapp', undefined, 'extend');

      expect(r.unregisterObject('myapp_invoice')).toBe(true);
      expect(r.getObjectContributors('myapp_invoice')).toEqual([]);
    });

    it('`force` overrides the guard, like the package-scoped verb\'s', () => {
      const r = quiet();
      r.registerObject(objectBody('myapp_invoice'), 'app.myapp');
      r.registerObject(objectBody('myapp_invoice', 'note'), 'app.addon', undefined, 'extend');

      expect(r.unregisterObject('myapp_invoice', { force: true })).toBe(true);
      expect(r.getObject('myapp_invoice')).toBeUndefined();
      expect(r.getObjectContributors('myapp_invoice')).toEqual([]);
    });

    /**
     * An owner-less object (only `extend` contributions) is ALREADY an ADR-0029
     * violation — `assertSingleOwnerPerObject` fails it at bootstrap. Removing
     * it silently would destroy contributions nobody asked to remove, so every
     * extender counts as "other" and the refusal is the same one.
     */
    it('refuses an owner-less object rather than silently tearing the extenders down', () => {
      const r = quiet();
      r.registerObject(objectBody('orphan_ext', 'note'), 'app.addon', undefined, 'extend');

      expect(() => r.unregisterObject('orphan_ext')).toThrowError(/app\.addon/);
      expect(r.getObjectContributors('orphan_ext')).toHaveLength(1);
      expect(r.unregisterObject('orphan_ext', { force: true })).toBe(true);
    });
  });

  /**
   * `computeFQN` is the identity function (Prime Directive #6 — object name IS
   * the table name; `namespace` is deprecated), so a contributor key differs
   * from the short name only for LEGACY `<ns>__<name>` names, which `parseFQN`
   * still splits. Both forms are exercised because `getObject` accepts both,
   * and this verb resolves names through the SAME code path it does — a
   * remover with its own resolution could remove an entry `getObject` never
   * served and leave the served one behind, which is this bug's shape one
   * layer down.
   */
  describe('name resolution — the same one `getObject` uses', () => {
    it('removes exactly the entry that was being SERVED, addressed by short name', () => {
      const r = quiet();
      r.registerObject(objectBody('crm__account'), 'app.crm');
      expect(r.getObject('account')).toBeDefined(); // legacy short-name resolution

      expect(r.unregisterObject('account')).toBe(true);

      expect(r.getObject('account')).toBeUndefined();
      // …and the key it lived under is gone with it.
      expect(r.resolveObject('crm__account')).toBeUndefined();
    });

    it('accepts the full key too, the disambiguation form `getObject` accepts', () => {
      const r = quiet();
      r.registerObject(objectBody('crm__account'), 'app.crm');

      expect(r.unregisterObject('crm__account')).toBe(true);
      expect(r.getObject('account')).toBeUndefined();
    });

    /**
     * Ambiguity resolves the way the READ resolves it — first match, same
     * warning — because "stop serving what you were serving" is the whole
     * contract.
     */
    it('an ambiguous short name removes the entry `getObject` would have returned', () => {
      const r = quiet();
      r.registerObject(objectBody('crm__account'), 'app.crm');
      r.registerObject(objectBody('erp__account'), 'app.erp');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const servedFqn = (r.getObject('account') as any)?.name;
        expect(servedFqn).toBeTruthy();

        expect(r.unregisterObject('account')).toBe(true);

        expect(r.resolveObject(servedFqn)).toBeUndefined();
        // The other one is untouched — one name removed, not two.
        expect(r.getObject('account')).toBeDefined();
        expect((r.getObject('account') as any).name).not.toBe(servedFqn);
      } finally {
        warn.mockRestore();
      }
    });
  });

  /**
   * The namespace is registered per PACKAGE and shared by every object that
   * package ships, so a single object's removal must not drop it —
   * `uninstallPackage` owns that half. Stated because the co-located state this
   * verb DOES clean up (contributors, merged cache, revision) makes "clean up
   * everything `registerObject` touched" a tempting over-reach.
   */
  it('leaves the package namespace registered — a sibling object still needs it', () => {
    const r = quiet();
    r.registerObject(objectBody('crm_account'), 'app.crm', 'crm');
    r.registerObject(objectBody('crm_contact'), 'app.crm', 'crm');

    r.unregisterObject('crm_account');

    expect(r.getNamespaceOwners('crm')).toContain('app.crm');
    expect(r.getObject('crm_contact')).toBeDefined();
  });

  /**
   * The invariant the guard protects, asserted end-to-end: after a legitimate
   * removal the registry still passes ADR-0029's bootstrap check. A removal that
   * left extenders behind would fail it with "has extenders but no owner".
   */
  it('leaves the ADR-0029 single-owner invariant intact', () => {
    const r = quiet();
    r.registerObject(objectBody('myapp_invoice'), 'app.myapp');
    r.registerObject(objectBody('myapp_quote'), 'app.myapp');
    r.registerObject(objectBody('myapp_quote', 'note'), 'app.addon', undefined, 'extend');

    r.unregisterObject('myapp_invoice');

    expect(() => r.assertSingleOwnerPerObject()).not.toThrow();
    expect(r.getObject('myapp_quote')).toBeDefined();
  });
});
