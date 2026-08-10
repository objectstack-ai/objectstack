// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0029 D9 — a tenant overlay of an object is its own contributor LAYER,
 * not a second `own`.
 *
 * ## What changed, and what deliberately did not
 *
 * Before D9 a tenant overlay reached `registerObject` with two arguments, so
 * `ownership` took its default `'own'`; when the row's `package_id` equalled
 * the packaged owner's id the re-registration branch SPLICED THE PACKAGED
 * CONTRIBUTOR OUT. The packaged definition was destroyed at write time — not
 * shadowed — and `loadMetaFromDb` replayed that destruction on every boot
 * (#6853, measured P1/P6).
 *
 * D9 registers the overlay as a third, NON-owning kind with replace semantics
 * on the base layer: `base = overlay ?? own`, extenders fold on top as before.
 * The load-bearing property, and the first thing this file pins, is that the
 * RESOLVED OBJECT DOES NOT MOVE — `resolveObject` answers bit-for-bit what the
 * old splice produced, `_provenance: 'org'` included. Only what the registry
 * REMEMBERS changes: the packaged owner is still there, underneath.
 *
 * ## Why several assertions here are guards rather than evidence
 *
 * D9.5 keeps `assertSingleOwnerPerObject` literally unchanged and D9.4 leaves
 * `computeFQN` alone, so the pins for those are green in both directions by
 * construction. They are here because ADR-0028's D5/D6 rest on that sentence
 * staying unconditional — a future "unless it is an overlay" clause must fail
 * something — and they are reported as guards, not as evidence for D9.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  SchemaRegistry,
  DEFAULT_OWNER_PRIORITY,
  DEFAULT_OVERLAY_PRIORITY,
  DEFAULT_EXTENDER_PRIORITY,
} from './registry.js';

const APP_PKG = 'app.myapp';
const OTHER_PKG = 'app.otherapp';
/** The key an overlay row bound to NO package keeps. */
const SENTINEL = 'sys_metadata';

/** The package's own body — carries a field the overlay does NOT. */
const packagedBody = (name: string) => ({
  name,
  label: 'Invoice',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name' },
    amount: { name: 'amount', type: 'number', label: 'Amount' },
    packaged_only: { name: 'packaged_only', type: 'text', label: 'Packaged only' },
  },
});

/** The tenant's overlay body — carries a field the package does NOT, and DROPS two. */
const overlayBody = (name: string) => ({
  name,
  label: 'Invoice (customized)',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name' },
    overlay_only: { name: 'overlay_only', type: 'text', label: 'Overlay only' },
  },
});

const silent = () => {
  const r = new SchemaRegistry({ multiTenant: false });
  r.logLevel = 'silent';
  return r;
};

const fieldNames = (r: SchemaRegistry, name: string) =>
  Object.keys((r.getObject(name) as any)?.fields ?? {});

const kinds = (r: SchemaRegistry, name: string) =>
  r.getObjectContributors(name).map((c) => c.ownership);

/** The registry as a package boot leaves it, plus the tenant's layer. */
function overlaidRegistry(name = 'myapp_invoice', binding: string = APP_PKG) {
  const r = silent();
  r.registerObject(packagedBody(name) as any, APP_PKG);
  r.registerObject({ ...overlayBody(name), _provenance: 'org' } as any, binding, undefined, 'overlay');
  return r;
}

describe('ADR-0029 D9.2 — the overlay REPLACES the base layer, bit for bit', () => {
  /**
   * THE CORRECTNESS CHECK THE CARD ASKS FOR. The right-hand registry is the
   * pre-D9 world expressed exactly: the overlay body registered as the sole
   * `own` contributor, which is what the splice left behind. If D9 moved the
   * resolved schema anywhere, this is where it shows.
   */
  it('resolves to exactly what the pre-D9 splice produced', () => {
    const d9 = overlaidRegistry();

    const preD9 = silent();
    // What the splice left: one contributor, the overlay body, owning the name.
    preD9.registerObject({ ...overlayBody('myapp_invoice'), _provenance: 'org' } as any, APP_PKG);

    expect(d9.getObject('myapp_invoice')).toEqual(preD9.getObject('myapp_invoice'));
  });

  it('keeps `_provenance: \'org\'` on the merged body — every registry-direct consumer reads it', () => {
    expect((overlaidRegistry().getObject('myapp_invoice') as any)._provenance).toBe('org');
  });

  it('serves the overlay body: the tenant\'s field is there and the dropped packaged ones are not', () => {
    const r = overlaidRegistry();
    expect(fieldNames(r, 'myapp_invoice')).toContain('overlay_only');
    expect(fieldNames(r, 'myapp_invoice')).not.toContain('packaged_only');
    expect(fieldNames(r, 'myapp_invoice')).not.toContain('amount');
  });

  /** The subtraction that is the whole point: nothing was destroyed. */
  it('the packaged OWNER survives underneath, with its own body and package id', () => {
    const r = overlaidRegistry();
    expect(kinds(r, 'myapp_invoice')).toEqual(['own', 'overlay']);
    const owner = r.getObjectOwner('myapp_invoice')!;
    expect(owner.packageId).toBe(APP_PKG);
    expect(Object.keys((owner.definition as any).fields)).toContain('packaged_only');
    expect((owner.definition as any)._provenance).toBe('package');
  });

  it('extenders still fold on top of whichever layer is the base', () => {
    const r = overlaidRegistry();
    r.registerObject(
      { name: 'myapp_invoice', fields: { ext_field: { name: 'ext_field', type: 'text' } } } as any,
      OTHER_PKG, undefined, 'extend',
    );
    expect(fieldNames(r, 'myapp_invoice')).toEqual(
      expect.arrayContaining(['name', 'overlay_only', 'ext_field']),
    );
    expect(fieldNames(r, 'myapp_invoice')).not.toContain('packaged_only');
  });

  /**
   * D9.2's REJECTED alternative, pinned by the behaviour that rejected it:
   * `mergeObjectDefinitions` is additive and has no expression for removal, so
   * an overlay modelled as an extender would silently resurrect every field
   * the tenant deleted. Replace semantics is what keeps a deletion deleted.
   */
  it('an overlay is NOT an extender: the fields it dropped stay dropped', () => {
    const asExtender = silent();
    asExtender.registerObject(packagedBody('myapp_invoice') as any, APP_PKG);
    asExtender.registerObject(
      { ...overlayBody('myapp_invoice'), _provenance: 'org' } as any, APP_PKG, undefined, 'extend',
    );
    // The counter-factual: as an extender the packaged fields come back.
    expect(Object.keys((asExtender.getObject('myapp_invoice') as any).fields)).toContain('packaged_only');
    // As an overlay they do not.
    expect(fieldNames(overlaidRegistry(), 'myapp_invoice')).not.toContain('packaged_only');
  });
});

describe('ADR-0029 D9.3 — priority orders peers; the KIND selects the base', () => {
  it('lists the stack in layer order: owner 100, overlay 150, extender 200', () => {
    const r = overlaidRegistry();
    r.registerObject({ name: 'myapp_invoice', fields: {} } as any, OTHER_PKG, undefined, 'extend');
    expect(r.getObjectContributors('myapp_invoice').map((c) => [c.ownership, c.priority])).toEqual([
      ['own', DEFAULT_OWNER_PRIORITY],
      ['overlay', DEFAULT_OVERLAY_PRIORITY],
      ['extend', DEFAULT_EXTENDER_PRIORITY],
    ]);
  });

  /**
   * The attack D9.3 names: extender priority is AUTHOR-declared
   * (`ext.priority ?? 200`), so a package could otherwise re-rank a tenant's
   * overlay out of the base slot by declaring a number below 150. Selection
   * asks the kind, so the number changes only the fold order.
   */
  it('an extender declaring priority 140 does not become the base layer', () => {
    const r = overlaidRegistry();
    r.registerObject(
      { name: 'myapp_invoice', fields: { sneaky: { name: 'sneaky', type: 'text' } } } as any,
      OTHER_PKG, undefined, 'extend', 140,
    );
    // It sorts BEFORE the overlay…
    expect(r.getObjectContributors('myapp_invoice').map((c) => c.priority)).toEqual([100, 140, 150]);

    // …and is still folded ONTO the overlay rather than being folded onto by
    // it: the base is the tenant's layer, which is what the identity of the
    // resolved body says. (Scalar props like `label` are "last writer wins"
    // across the fold for extenders and always have been — that is the
    // extension model, not base selection, so it is not the discriminator.)
    const merged = r.getObject('myapp_invoice') as any;
    expect(merged._provenance).toBe('org');
    expect(Object.keys(merged.fields)).toContain('overlay_only');
    expect(Object.keys(merged.fields)).not.toContain('packaged_only');
    expect(Object.keys(merged.fields)).toContain('sneaky');

    // The control: with the layer gone, the SAME extender folds onto the
    // packaged owner instead — so the assertion above is about which layer is
    // the base, not about the extender being inert.
    r.removeObjectOverlay('myapp_invoice');
    const restored = r.getObject('myapp_invoice') as any;
    expect(restored._provenance).toBe('package');
    expect(Object.keys(restored.fields)).toContain('packaged_only');
    expect(Object.keys(restored.fields)).toContain('sneaky');
  });
});

describe('ADR-0029 D9.6 — artifact identity is read from the OWNER contributor', () => {
  /**
   * The clause that makes `isArtifactBacked` stop lying, and the one D9 says
   * is NOT implied by the layering change: D9.2 deliberately leaves the merged
   * body carrying `_provenance: 'org'`, so a predicate that reads the merged
   * body answers about the tenant even though the package still ships the name.
   */
  it('a packaged object with a tenant overlay IS artifact-backed', () => {
    const r = overlaidRegistry();
    const item = r.getArtifactItem<any>('object', 'myapp_invoice');
    expect(item).toBeDefined();
    // …and what comes back is the CODE-layer baseline, not the tenant body.
    expect(Object.keys(item.fields)).toContain('packaged_only');
    expect(item._provenance).toBe('package');
    expect(item._packageId).toBe(APP_PKG);
  });

  /**
   * The other direction, and the reason cloud#970 stays closed: an app the
   * user just built through Studio/AI has no package layer at all — the owner
   * IS the tenant's row — so it must stay editable.
   */
  it('a runtime-authored object with no package layer is NOT artifact-backed', () => {
    const r = silent();
    r.registerObject({ ...overlayBody('eymm_project'), _provenance: 'org' } as any, 'app.eymm');
    expect(r.getArtifactItem('object', 'eymm_project')).toBeUndefined();
  });

  it('the `sys_metadata` sentinel is still not an artifact', () => {
    const r = silent();
    r.registerObject(overlayBody('runtime_thing') as any, SENTINEL);
    expect(r.getArtifactItem('object', 'runtime_thing')).toBeUndefined();
  });

  /**
   * Guard, green in both directions: with no overlay registered the code-layer
   * resolution is byte-for-byte the merged object, so the honest predicate
   * costs nothing on the overwhelmingly common shape — including extenders.
   */
  it('with no overlay, the artifact item still carries the extenders (unchanged)', () => {
    const r = silent();
    r.registerObject(packagedBody('myapp_invoice') as any, APP_PKG);
    r.registerObject(
      { name: 'myapp_invoice', fields: { ext_field: { name: 'ext_field', type: 'text' } } } as any,
      OTHER_PKG, undefined, 'extend',
    );
    expect(r.getArtifactItem<any>('object', 'myapp_invoice')).toEqual(r.getObject('myapp_invoice'));
  });
});

describe('ADR-0029 D9 blast radius — the `own`-gated sites, one by one', () => {
  /**
   * Blast-radius row 2, and the silent regression D9 warns about by name: the
   * overlay body IS the resolved base, so gating title provisioning on `own`
   * would leave `nameField` unset on every overlaid object.
   */
  it('the overlay layer is title-provisioned, so `nameField` does not move', () => {
    const packagedOnly = silent();
    packagedOnly.registerObject(packagedBody('myapp_invoice') as any, APP_PKG);
    const expected = (packagedOnly.getObject('myapp_invoice') as any).nameField;
    expect(expected).toBeTruthy();

    expect((overlaidRegistry().getObject('myapp_invoice') as any).nameField).toBe(expected);
  });

  it('`getObjectOwner` never answers with the overlay — it still means "owns the table"', () => {
    expect(overlaidRegistry('myapp_invoice', SENTINEL).getObjectOwner('myapp_invoice')?.packageId).toBe(APP_PKG);
  });

  it('`getAllObjects` stamps the PACKAGED owner\'s id, and both bindings still match the filter', () => {
    const r = overlaidRegistry('myapp_invoice', SENTINEL);
    expect((r.getAllObjects().find((o) => o.name === 'myapp_invoice') as any)._packageId).toBe(APP_PKG);
    // `getAllObjects(packageId)` matches ANY contribution, owner or not.
    expect(r.getAllObjects(APP_PKG).map((o) => o.name)).toContain('myapp_invoice');
    expect(r.getAllObjects(SENTINEL).map((o) => o.name)).toContain('myapp_invoice');
  });
});

describe('ADR-0029 D9.5 — the single-owner assertion, unchanged, plus one class', () => {
  /**
   * Guard, green in both directions. It is here because ADR-0028's D5/D6 rest
   * on D3 being unconditional: an overlay must never be counted as an owner,
   * so the sentence keeps holding with no exemption list.
   */
  it('an overlaid object still has exactly ONE owner', () => {
    expect(() => overlaidRegistry().assertSingleOwnerPerObject()).not.toThrow();
  });

  it('a second cross-package OWNER is still refused at registration', () => {
    const r = overlaidRegistry();
    expect(() => r.registerObject(packagedBody('myapp_invoice') as any, OTHER_PKG))
      .toThrow(/already owned by package "app\.myapp"/);
  });

  /**
   * The one class D9 adds. Reachable by uninstalling the packaged owner while a
   * SENTINEL-bound row for its object still exists — the seam
   * `unregisterObjectsByPackage` cannot reach by package id.
   */
  it('an ORPHAN overlay (overlay, no owner) is a violation, and says which it is', () => {
    const r = overlaidRegistry('myapp_invoice', SENTINEL);
    // Reach the state directly: drop the owner without the package walk.
    r.unregisterObjectsByPackage(APP_PKG, true);
    r.registerObject({ ...overlayBody('myapp_invoice'), _provenance: 'org' } as any, SENTINEL, undefined, 'overlay');

    expect(kinds(r, 'myapp_invoice')).toEqual(['overlay']);
    expect(() => r.assertSingleOwnerPerObject()).toThrow(/orphan overlay layer/);
    // …and it is not mis-described as an extender problem.
    expect(() => r.assertSingleOwnerPerObject()).not.toThrow(/only extend contributions/);
  });

  it('an orphan overlay resolves to nothing, and the warning names the layer', () => {
    const r = silent();
    r.registerObject({ ...overlayBody('ghost'), _provenance: 'org' } as any, SENTINEL, undefined, 'overlay');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(r.getObject('ghost')).toBeUndefined();
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/overlay layer but no owner/);
    } finally {
      warn.mockRestore();
    }
  });

  /** Guard: the pre-existing owner-less shape keeps its own wording. */
  it('extenders with no owner still report the extend violation', () => {
    const r = silent();
    r.registerObject({ name: 'nobody', fields: {} } as any, OTHER_PKG, undefined, 'extend');
    expect(() => r.assertSingleOwnerPerObject()).toThrow(/only extend contributions/);
  });
});

describe('ADR-0029 D9.9 — at most ONE overlay layer per object name', () => {
  /**
   * Keyed by KIND, never by package. The overlay-uniqueness index in
   * `sys_metadata` keys on `(type, name, organization_id, COALESCE(package_id,
   * ''))` and can legitimately hold two rows for one `(type, name)` bound to
   * two packages; `computeFQN` is identity, so the registry holds exactly one
   * entry per object name and could never serve two. Replacing by package
   * would let that unrepresentable shape in through the side door.
   */
  it('re-writing the layer REPLACES it, even under a different binding', () => {
    const r = overlaidRegistry('myapp_invoice', SENTINEL);
    r.registerObject(
      { name: 'myapp_invoice', label: 'Second', fields: { second_only: { name: 'second_only', type: 'text' } }, _provenance: 'org' } as any,
      APP_PKG, undefined, 'overlay',
    );
    expect(kinds(r, 'myapp_invoice')).toEqual(['own', 'overlay']);
    expect(fieldNames(r, 'myapp_invoice')).toContain('second_only');
    expect(fieldNames(r, 'myapp_invoice')).not.toContain('overlay_only');
  });
});

describe('ADR-0029 D9.7 — removal is a subtraction', () => {
  it('`removeObjectOverlay` drops the layer and the packaged owner is served again', () => {
    const r = overlaidRegistry();
    expect(r.removeObjectOverlay('myapp_invoice')).toBe(true);

    expect(kinds(r, 'myapp_invoice')).toEqual(['own']);
    const merged = r.getObject('myapp_invoice') as any;
    expect(Object.keys(merged.fields)).toContain('packaged_only');
    expect(merged._provenance).toBe('package');
    expect(merged.label).toBe('Invoice');
    // The warm merge cache cannot outlive the removal.
    expect(r.getArtifactItem('object', 'myapp_invoice')).toBeDefined();
  });

  it('is idempotent, and answers `false` when there is no layer to remove', () => {
    const r = overlaidRegistry();
    expect(r.removeObjectOverlay('myapp_invoice')).toBe(true);
    expect(r.removeObjectOverlay('myapp_invoice')).toBe(false);
    expect(r.removeObjectOverlay('never_registered')).toBe(false);
    // …and the object is still there: it removes a LAYER, not the object.
    expect(r.getObject('myapp_invoice')).toBeDefined();
  });

  it('bumps objectRevision so registry-derived caches learn the set moved', () => {
    const r = overlaidRegistry();
    const before = r.objectRevision;
    r.removeObjectOverlay('myapp_invoice');
    expect(r.objectRevision).toBeGreaterThan(before);
  });

  it('uninstalling the owning package takes the overlay layer with it', () => {
    const r = overlaidRegistry('myapp_invoice', SENTINEL);
    r.unregisterObjectsByPackage(APP_PKG);
    // No orphan is manufactured: the whole entry is gone, not a layer with no base.
    expect(r.getObjectContributors('myapp_invoice')).toHaveLength(0);
    expect(() => r.assertSingleOwnerPerObject()).not.toThrow();
  });

  /** Guard: the name-addressed removal keeps taking the whole entry (#6808). */
  it('`unregisterObject` still removes the object and every layer of it', () => {
    const r = overlaidRegistry();
    expect(r.unregisterObject('myapp_invoice')).toBe(true);
    expect(r.getObject('myapp_invoice')).toBeUndefined();
    expect(r.getObjectContributors('myapp_invoice')).toHaveLength(0);
  });
});

describe('ADR-0029 D9 §6.1 — LATE INSTALL: the code layer takes ownership', () => {
  /**
   * A package registering an object a tenant row already holds. Before D9 the
   * row had taken the `own` slot by default, so this threw "already owned by"
   * under a foreign id — the case D9 left open for this card.
   *
   * The recommended default, and the only outcome that loses nothing: the code
   * layer becomes the owner and the tenant contribution is re-classified as its
   * overlay layer. The resolved object does not move; what changes is that the
   * packaged definition now survives underneath it.
   */
  it('a package arriving after a SENTINEL-bound tenant row is not refused', () => {
    const r = silent();
    r.registerObject({ ...overlayBody('myapp_invoice'), _provenance: 'org' } as any, SENTINEL);
    const before = r.getObject('myapp_invoice');

    expect(() => r.registerObject(packagedBody('myapp_invoice') as any, APP_PKG)).not.toThrow();

    expect(kinds(r, 'myapp_invoice')).toEqual(['own', 'overlay']);
    expect(r.getObjectOwner('myapp_invoice')?.packageId).toBe(APP_PKG);
    // The resolved object did not move…
    expect(r.getObject('myapp_invoice')).toEqual(before);
    // …and the predicate is honest from this moment on.
    expect(r.getArtifactItem('object', 'myapp_invoice')).toBeDefined();
    expect(() => r.assertSingleOwnerPerObject()).not.toThrow();
  });

  /**
   * The SAME-package spelling, which pre-D9 did not throw — it took the
   * re-registration splice and destroyed the tenant's customization instead.
   */
  it('a package arriving after a row bound to its OWN id does not destroy the customization', () => {
    const r = silent();
    r.registerObject({ ...overlayBody('myapp_invoice'), _provenance: 'org' } as any, APP_PKG);

    r.registerObject(packagedBody('myapp_invoice') as any, APP_PKG);

    expect(kinds(r, 'myapp_invoice')).toEqual(['own', 'overlay']);
    expect(fieldNames(r, 'myapp_invoice')).toContain('overlay_only');
    expect(r.getObjectOwner('myapp_invoice')?.packageId).toBe(APP_PKG);
    expect((r.getObjectOwner('myapp_invoice')!.definition as any)._provenance).toBe('package');
  });

  /**
   * THE BOUNDARY, and why the re-classification is not a hole in D3: it fires
   * only when the sitting owner is TENANT-authored. Two code packages claiming
   * one name is still the cross-package refusal, whatever the ids.
   */
  it('does NOT re-classify a packaged owner — a second code package is still refused', () => {
    const r = silent();
    r.registerObject(packagedBody('myapp_invoice') as any, APP_PKG);
    expect(() => r.registerObject(packagedBody('myapp_invoice') as any, OTHER_PKG))
      .toThrow(/already owned by package "app\.myapp"/);
    expect(kinds(r, 'myapp_invoice')).toEqual(['own']);
  });

  /** Guard: an ordinary tenant re-write is still a re-registration, not a layer over itself. */
  it('a tenant re-writing its OWN runtime object stays a single `own` contributor', () => {
    const r = silent();
    r.registerObject({ ...overlayBody('eymm_project'), _provenance: 'org' } as any, 'app.eymm');
    r.registerObject({ ...overlayBody('eymm_project'), label: 'v2', _provenance: 'org' } as any, 'app.eymm');
    expect(kinds(r, 'eymm_project')).toEqual(['own']);
    expect((r.getObject('eymm_project') as any).label).toBe('v2');
  });
});

describe('ADR-0029 D9.8 — `getPackagedObjectOwner`, the hydration discriminator', () => {
  it('answers the packaged owner for a code-shipped name', () => {
    expect(overlaidRegistry().getPackagedObjectOwner('myapp_invoice')?.packageId).toBe(APP_PKG);
  });

  it('answers undefined for a runtime-authored object — its owner IS the tenant row', () => {
    const r = silent();
    r.registerObject({ ...overlayBody('eymm_project'), _provenance: 'org' } as any, 'app.eymm');
    expect(r.getPackagedObjectOwner('eymm_project')).toBeUndefined();
  });

  it('answers undefined for a name nothing has registered', () => {
    expect(silent().getPackagedObjectOwner('nothing_here')).toBeUndefined();
  });
});

describe('ADR-0029 D9.4 — `computeFQN` is untouched, so the namespace loss is repaired for free', () => {
  /**
   * P5 measured the packaged owner's `namespace` field coming back as `''`
   * where the package had `'myapp'` — destroyed with the contributor. D9 fixes
   * it by SUBTRACTION rather than by a rule: the owner is no longer removed.
   */
  it('the packaged owner keeps its namespace when a tenant layer arrives', () => {
    const r = silent();
    r.registerObject(packagedBody('myapp_invoice') as any, APP_PKG, 'myapp');
    r.registerObject(
      { ...overlayBody('myapp_invoice'), _provenance: 'org' } as any, APP_PKG, undefined, 'overlay',
    );
    expect(r.getObjectOwner('myapp_invoice')?.namespace).toBe('myapp');
    expect(r.getNamespaceOwner('myapp')).toBe(APP_PKG);
  });
});
