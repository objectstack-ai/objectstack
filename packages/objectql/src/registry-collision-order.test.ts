// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12027] The artifact-vs-DB collision warning fires in BOTH registration
 * orders — including the one a cold boot actually produces.
 *
 * ## What was wrong, and why "the warning is missing" is the wrong description
 *
 * The warning existed and worked. It was guarded on `packageId &&`, so it
 * spoke only when the PACKAGE registered second. A kernel boot cannot produce
 * that order:
 *
 * ```
 * Phase 1  init   AppPlugin.init -> manifest.register -> ObjectQL.registerApp
 *                 -> registerItem(type, item, 'name', packageId)   // pkg:name
 * Phase 2  start  ObjectQLPlugin.start -> restoreMetadataFromDb
 *                 -> protocol.loadMetaFromDb -> hydrateOverlayIntoRegistry
 *                 -> registerItem(type, item, 'name')              // bare name
 * ```
 *
 * The kernel runs init-all THEN start-all, so the artifact is ALWAYS the first
 * arrival at boot and the overlay always the second — the exact order the
 * `packageId &&` half excluded. Measured on a real `@objectstack/example-crm`
 * boot: one stored `view` overlay of a packaged view produced **0** collision
 * lines and 4 silent shadowings (the container plus its three expanded
 * ViewItems). So a reader who had ever SEEN the warning fire (a marketplace
 * install, an HMR reload — the late-registration order) had every reason to
 * believe the mechanism was sound, while the case it missed was the one that
 * happens on every boot.
 *
 * That is why the first case below is the load-bearing one: a pin written only
 * for the direction that already warned would pass on `origin/main` and prove
 * nothing.
 *
 * ## Two messages, not one widened message
 *
 * Both orders end in the same state — `getItem` checks the bare key first, so
 * the runtime row wins either way (pinned at the bottom of this file, because
 * a diagnostic repair must not move precedence). What differs is the EVENT,
 * and the event is what an operator acts on: a package that is dead on arrival
 * behind a row that predates it, versus a stored row taking over a definition
 * this process just loaded from code. `distinguishable messages` pins that a
 * later "one message fits both" simplification cannot silently drop it.
 *
 * ## The narrowing cases are not decoration
 *
 * A warning that fires on every boot of a normal deployment says nothing (the
 * #12015 ruling, one warning over). Three of the cases below are the volume
 * bound: no packaged item means no line at all, a re-registration of the same
 * overlay is silent (the line marks the transition, not the state — otherwise
 * the read-side hydration would warn once per GET), and a composite entry that
 * is itself an overlay or a tenant-authored body is not a packaged definition
 * being shadowed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SchemaRegistry } from './registry';

const PKG = 'com.acme.crm';

/** Every `[Registry] Collision` line emitted while `fn` runs. */
function collisionsDuring(fn: () => void): string[] {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    fn();
    return spy.mock.calls
      .map((args) => args.map((a) => String(a)).join(' '))
      .filter((line) => line.includes('[Registry] Collision'));
  } finally {
    spy.mockRestore();
  }
}

describe('[#12027] SchemaRegistry collision warning is order-symmetric', () => {
  let registry: SchemaRegistry;

  beforeEach(() => {
    registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('COMMON COLD-BOOT ORDER — artifact first, then the sys_metadata row: warns', () => {
    // The case that was silent on `origin/main`. Phase 1 registers the packaged
    // flow under `pkg:name`; Phase 2 hydrates the stored row under the bare name.
    registry.registerItem('flow', { name: 'nightly_sync', label: 'packaged' }, 'name', PKG);

    const lines = collisionsDuring(() => {
      registry.registerItem('flow', { name: 'nightly_sync', label: 'runtime' }, 'name');
    });

    expect(lines).toHaveLength(1);
    // The line has to carry the three things an operator needs: which item,
    // which package lost, and what now serves.
    expect(lines[0]).toContain('flow/nightly_sync');
    expect(lines[0]).toContain(PKG);
    expect(lines[0]).toContain('shadows the package value');
  });

  it('[#12609] quotes the shadowed package id with single quotes, matching this package\'s own convention', () => {
    // Measured over non-test `.ts` under `packages/objectql/src`: interpolated
    // identifiers in operator prose are single-quoted 174 times against 37
    // double-quoted — this line WAS one of the 37. `toContain` is not enough
    // on its own (a substring check can't see which quote character surrounds
    // it), so both directions are asserted explicitly: the correct spelling is
    // present, and the pre-fix spelling is not — the same "would notice a
    // disagreement" shape #12563 used for the sibling phrase in
    // `service-automation`.
    registry.registerItem('flow', { name: 'nightly_sync', label: 'packaged' }, 'name', PKG);

    const lines = collisionsDuring(() => {
      registry.registerItem('flow', { name: 'nightly_sync', label: 'runtime' }, 'name');
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`package '${PKG}'`);
    expect(lines[0]).not.toContain(`package "${PKG}"`);
  });

  it('LATE-REGISTRATION ORDER — sys_metadata row first, then the package: still warns', () => {
    // Unchanged behaviour, pinned so the repair cannot trade one order for the
    // other. This order is a marketplace install / HMR reload, not a boot.
    registry.registerItem('flow', { name: 'nightly_sync', label: 'runtime' }, 'name');

    const lines = collisionsDuring(() => {
      registry.registerItem('flow', { name: 'nightly_sync', label: 'packaged' }, 'name', PKG);
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('flow/nightly_sync');
    expect(lines[0]).toContain('will shadow the package value');
  });

  it('the two orders produce DISTINGUISHABLE messages', () => {
    // Same end state, different event. A reader must be able to tell "your new
    // package is dead on arrival" from "a stored row just took over"; a single
    // message widened to fit both would have to drop which one arrived second.
    const bootOrder = collisionsDuring(() => {
      registry.registerItem('page', { name: 'home', label: 'packaged' }, 'name', PKG);
      registry.registerItem('page', { name: 'home', label: 'runtime' }, 'name');
    });
    const lateOrder = collisionsDuring(() => {
      registry.registerItem('doc', { name: 'home', label: 'runtime' }, 'name');
      registry.registerItem('doc', { name: 'home', label: 'packaged' }, 'name', PKG);
    });

    expect(bootOrder).toHaveLength(1);
    expect(lateOrder).toHaveLength(1);
    expect(bootOrder[0]).not.toEqual(lateOrder[0]);
    // The tense is the discriminator, and it is the accurate part: one has
    // already happened, the other is what the arriving package is walking into.
    expect(bootOrder[0]).toContain('has just been registered from sys_metadata');
    expect(lateOrder[0]).toContain('already');
  });

  it('a discriminated bundle member is judged against its OWN member key', () => {
    // [#7730] `email_template` is keyed by (name, locale). The overlay slot the
    // warning asks about is the member with the SAME discriminator, so the
    // packaged `zh-CN` member and the stored `zh-CN` row collide.
    registry.registerItem(
      'email_template',
      { name: 'welcome', locale: 'zh-CN', subject: 'packaged' },
      'name',
      PKG,
    );

    const lines = collisionsDuring(() => {
      registry.registerItem(
        'email_template',
        { name: 'welcome', locale: 'zh-CN', subject: 'runtime' },
        'name',
      );
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('email_template/welcome');
  });

  describe('what is NOT a collision — the volume bound', () => {
    it('a runtime row with no packaged counterpart is silent', () => {
      const lines = collisionsDuring(() => {
        registry.registerItem('flow', { name: 'tenant_only', label: 'runtime' }, 'name');
      });
      expect(lines).toEqual([]);
    });

    it('re-registering the SAME overlay warns once, not once per registration', () => {
      // The read-side hydration (`getMetaItems`) and the write-through both
      // re-register an overlay that is already in the bare slot. Warning on the
      // STATE rather than the transition would put a line in the log on every
      // GET of a customized item.
      registry.registerItem('flow', { name: 'nightly_sync', label: 'packaged' }, 'name', PKG);

      const first = collisionsDuring(() => {
        registry.registerItem('flow', { name: 'nightly_sync', label: 'runtime' }, 'name');
      });
      const repeats = collisionsDuring(() => {
        registry.registerItem('flow', { name: 'nightly_sync', label: 'runtime v2' }, 'name');
        registry.registerItem('flow', { name: 'nightly_sync', label: 'runtime v3' }, 'name');
      });

      expect(first).toHaveLength(1);
      expect(repeats).toEqual([]);
    });

    it('a composite entry carrying the sys_metadata sentinel is not a packaged definition', () => {
      // `_packageId: 'sys_metadata'` marks an overlay bound to no package
      // (#4636). Nothing shipped from code here, so nothing is being shadowed.
      registry.registerItem(
        'flow',
        { name: 'nightly_sync', _packageId: 'sys_metadata' },
        'name',
        'sys_metadata',
      );
      const lines = collisionsDuring(() => {
        registry.registerItem('flow', { name: 'nightly_sync', label: 'runtime' }, 'name');
      });
      expect(lines).toEqual([]);
    });

    it('a tenant-authored composite entry is not a packaged definition', () => {
      // ADR-0010 `_provenance: 'org'` — a tenant's own item that came back from
      // a kernel rebuild keyed by a package id (cloud#970). `isCodeArtifactBody`
      // is the single answer to "does a code package ship this?", and this is
      // not it.
      registry.registerItem(
        'flow',
        { name: 'nightly_sync', _packageId: PKG, _provenance: 'org' },
        'name',
        PKG,
      );
      const lines = collisionsDuring(() => {
        registry.registerItem('flow', { name: 'nightly_sync', label: 'runtime' }, 'name');
      });
      expect(lines).toEqual([]);
    });

    it('a package re-registering its own item is silent in both directions', () => {
      const lines = collisionsDuring(() => {
        registry.registerItem('flow', { name: 'nightly_sync', label: 'v1' }, 'name', PKG);
        registry.registerItem('flow', { name: 'nightly_sync', label: 'v2' }, 'name', PKG);
      });
      expect(lines).toEqual([]);
    });

    it('two packages shipping the same bare name is coexistence, not shadowing', () => {
      // ADR-0048 §3.4 — distinct composite keys, package-scoped resolution.
      // Neither registration takes the bare slot, so this guard never speaks.
      const lines = collisionsDuring(() => {
        registry.registerItem('page', { name: 'home', label: 'CRM' }, 'name', PKG);
        registry.registerItem('page', { name: 'home', label: 'HR' }, 'name', 'com.acme.hr');
      });
      expect(lines).toEqual([]);
    });
  });

  describe('the diagnostic repair moves nothing', () => {
    it('the runtime row still wins in BOTH orders (ADR-0005 overlay precedence)', () => {
      // Clause ② in test form: this card adds a line to a path that printed
      // nothing. Which definition wins is untouched, and untouched IN BOTH
      // ORDERS — a warning that changed precedence would be a different card.
      const bootOrder = new SchemaRegistry({ multiTenant: false });
      bootOrder.logLevel = 'silent';
      collisionsDuring(() => {
        bootOrder.registerItem('flow', { name: 'nightly_sync', label: 'packaged' }, 'name', PKG);
        bootOrder.registerItem('flow', { name: 'nightly_sync', label: 'runtime' }, 'name');
      });
      expect(bootOrder.getItem<any>('flow', 'nightly_sync')?.label).toBe('runtime');
      expect(bootOrder.getItem<any>('flow', 'nightly_sync', PKG)?.label).toBe('runtime');
      // …and the packaged definition is still reachable as an artifact.
      expect(bootOrder.getArtifactItem<any>('flow', 'nightly_sync', PKG)?.label).toBe('packaged');

      const lateOrder = new SchemaRegistry({ multiTenant: false });
      lateOrder.logLevel = 'silent';
      collisionsDuring(() => {
        lateOrder.registerItem('flow', { name: 'nightly_sync', label: 'runtime' }, 'name');
        lateOrder.registerItem('flow', { name: 'nightly_sync', label: 'packaged' }, 'name', PKG);
      });
      expect(lateOrder.getItem<any>('flow', 'nightly_sync')?.label).toBe('runtime');
    });
  });
});
