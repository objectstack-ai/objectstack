// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The settings ORDERING contract (#10250) — declared, not incidental.
 *
 * ## What went wrong
 *
 * `SettingsServicePlugin` binds its data engine from a `kernel:ready` hook
 * registered in its `start()`. Three shipped plugins read a settings namespace
 * from a `kernel:ready` hook registered in THEIR `start()`:
 *
 *   `plugin-email`   → `getNamespace('mail')`     — SMTP / provider / from-address
 *   `service-sms`    → `getNamespace('sms')`      — provider credentials, cost ceiling
 *   `service-storage`→ `getNamespace('storage')`  — backend + credentials
 *
 * Hooks fire in registration order, so whichever plugin STARTS first registers
 * the earlier hook. A reader that started before the settings plugin therefore
 * read `SettingsService`'s in-memory fallback — empty at boot — and received the
 * manifest DEFAULTS with `locked: false` and no diagnostic, while the operator's
 * saved row sat unread in `sys_setting`.
 *
 * Until this change **nothing constrained that order**. None of the three
 * declared any dependency on `com.objectstack.service.settings`, so their
 * position was pure `kernel.use()` order. It happened to be right under
 * `os serve` only because the always-on slate lists `settings` before them —
 * and `serve` PREPENDS an app's declared `requires`, so an ordinary
 * `requires: ['email']` produced email-before-settings and bypassed that
 * entirely. Cloud's objectos-runtime mounts the slate from its own wiring,
 * which is why a CLI-only repair was rejected.
 *
 * ## Why this file lives in `@objectstack/cli`
 *
 * It needs the REAL plugin classes and the REAL slate in one place. `cli` is the
 * only package that depends on all of them, and it is the runtime that actually
 * appends `PLATFORM_ALWAYS_ON_CAPABILITIES` to an app's `requires`
 * (`Serve.ALWAYS_ON_CAPABILITIES` is a re-export of it).
 *
 * ⚠️ **Resolution: these imports reach `dist/`, deliberately.** Every specifier
 * below is a bare workspace package listed in
 * `KNOWN_UNALIASED_TEST_IMPORTS['@objectstack/cli']`
 * (`scripts/check-test-source-alias.mjs`), and `packages/cli/vitest.config.ts`
 * aliases only `@objectstack/service-cache` and `create-objectstack/created-summary`.
 * That registry is ⛔ SHRINK-ONLY and aliasing a fourth dependency to source
 * would pull its whole import surface into this package's resolution domain for
 * all ~137 test files (the #7378 shape). So this file reads BUILT plugin
 * classes: a change to any of the three manifests needs
 * `pnpm --filter <pkg> build` before this file can see it, and an ablation of
 * one of them is only believable if the rebuild is proved to have reached
 * `dist/`.
 *
 * ## What each case pins, and why it cannot pass vacuously
 *
 *  1. the three shipped readers each DECLARE the edge;
 *  2. the declaration MOVES resolution order — proved by deleting it from a live
 *     instance and watching the order revert, not by asserting the key exists
 *     (ADR-0049: a declaration nothing reads is the defect, not the fix);
 *  3. the slate keeps every non-foundational entry after the services that get
 *     bound into during `kernel:ready` — a boundary DERIVED from what the pin is
 *     for, so an eleventh entry added tomorrow is covered rather than one past
 *     the end of a hard-coded slice.
 */

import { describe, it, expect } from 'vitest';
import { resolvePluginOrder } from '@objectstack/core';
import type { OrderablePlugin } from '@objectstack/core';
import { PLATFORM_ALWAYS_ON_CAPABILITIES } from '@objectstack/spec/kernel';
import { EmailServicePlugin } from '@objectstack/plugin-email';
import { SmsServicePlugin } from '@objectstack/service-sms';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { SettingsServicePlugin } from '@objectstack/service-settings';

const SETTINGS_PLUGIN = 'com.objectstack.service.settings';

/**
 * The always-on capability tokens whose provider plugin reads a settings
 * namespace from its own `kernel:ready` hook, paired with that plugin.
 *
 * Enumerated rather than discovered because the discovery would have to import
 * all ten always-on providers (see the resolution note above). Case 4 is what
 * keeps the enumeration honest in the direction that matters: a settings-reading
 * plugin that FORGETS the declaration drops out of this file's derived set, and
 * case 1's floor turns red.
 */
const SETTINGS_READING_ALWAYS_ON: ReadonlyArray<{ token: string; plugin: () => OrderablePlugin }> = [
  { token: 'email', plugin: () => new EmailServicePlugin() as unknown as OrderablePlugin },
  { token: 'sms', plugin: () => new SmsServicePlugin() as unknown as OrderablePlugin },
  { token: 'storage', plugin: () => new StorageServicePlugin() as unknown as OrderablePlugin },
];

/**
 * `EmailServicePlugin` declares `com.objectstack.engine.objectql` a HARD
 * dependency, so every registry below has to contain it or `resolvePluginOrder`
 * throws before it can order anything. Name-only: this module orders plugins by
 * their declarations and never runs a lifecycle.
 */
const engineStub = (): OrderablePlugin => ({ name: 'com.objectstack.engine.objectql' });

const newSettingsPlugin = (): OrderablePlugin =>
  new SettingsServicePlugin({
    registerRoutes: false, manifests: [], actionHandlers: {},
  }) as unknown as OrderablePlugin;

/** Registry in the given insertion order — `resolvePluginOrder` preserves it
 *  for plugins with no edges between them, which is what makes the hostile
 *  order below hostile. */
const registryOf = (...plugins: OrderablePlugin[]) =>
  new Map<string, OrderablePlugin>(plugins.map((p) => [p.name, p]));

/**
 * The always-on entries that other entries BIND INTO during `kernel:ready`, in
 * the order they must be mounted. This is what the foundational prefix was
 * always for — the spec-side pin's own comment says so: *"Order matters at mount
 * time: settings/queue/job must precede the services that bind to them during
 * their own `kernel:ready` phase."*
 *
 * Stating the prefix as a ROLE rather than as a count is the whole point of
 * case 5. `PLATFORM_ALWAYS_ON_CAPABILITIES.slice(0, 6)` bundled the four
 * bind-TARGETS together with two of their readers (`email`, `storage`) and
 * stopped one short of the third (`sms`, at index 6) — an off-by-one that reads
 * as correct at a glance and left `sms`'s position held by nothing.
 */
const BIND_TARGETS = ['queue', 'job', 'cache', 'settings'] as const;

const slateIndex = (token: string) => PLATFORM_ALWAYS_ON_CAPABILITIES.indexOf(token);

describe('settings-reading plugins declare the ordering edge (ADR-0116)', () => {
  it('1. all three shipped always-on readers declare `com.objectstack.service.settings`', () => {
    // The floor. An empty or shrunken derived set would make cases 2-3 pass
    // over nothing, so the count is asserted before anything is derived from it.
    expect(SETTINGS_READING_ALWAYS_ON).toHaveLength(3);
    expect(SETTINGS_READING_ALWAYS_ON.map((r) => r.token).sort()).toEqual(
      ['email', 'sms', 'storage'],
    );

    for (const { token, plugin } of SETTINGS_READING_ALWAYS_ON) {
      const declared = (plugin() as { optionalDependencies?: string[] }).optionalDependencies ?? [];
      expect(declared, `${token} must declare the settings ordering edge`).toContain(
        SETTINGS_PLUGIN,
      );
    }
  });

  it('2. the declaration MOVES resolution order — settings inits/starts first even when used last', () => {
    // `ObjectKernel.bootstrap` and `LiteKernel.bootstrap` both iterate the
    // SAME `resolvePluginOrder` output for Phase 1 (init) and Phase 2 (start),
    // so this is the order the `kernel:ready` hooks get registered in.
    for (const { token, plugin } of SETTINGS_READING_ALWAYS_ON) {
      const reader = plugin();
      // Hostile insertion order: the READER first, the settings plugin last.
      const registry = registryOf(engineStub(), reader, newSettingsPlugin());
      const ordered = resolvePluginOrder(registry).map((p) => p.name);
      expect(
        ordered.indexOf(SETTINGS_PLUGIN),
        `${token}: settings must resolve ahead of the reader`,
      ).toBeLessThan(ordered.indexOf(reader.name));
    }
  });

  it('3. …and the declaration is what does it — forget it and the order reverts', () => {
    // The ADR-0049 half. Case 2 alone would still pass if `resolvePluginOrder`
    // happened to hoist by some other rule; this proves the DECLARATION is the
    // cause by removing it from a live instance and re-resolving.
    for (const { token, plugin } of SETTINGS_READING_ALWAYS_ON) {
      const reader = plugin();
      // Storage declares TWO optional edges; drop only the settings one so the
      // objectql edge it shares with the other readers is not what changes.
      const kept = ((reader as { optionalDependencies?: string[] }).optionalDependencies ?? [])
        .filter((d) => d !== SETTINGS_PLUGIN);
      (reader as { optionalDependencies?: string[] }).optionalDependencies = kept;

      const registry = registryOf(engineStub(), reader, newSettingsPlugin());
      const ordered = resolvePluginOrder(registry).map((p) => p.name);
      // Insertion order is preserved for plugins with no edges between them —
      // so with the declaration gone the reader is back in front, which is the
      // defect this card was filed about.
      expect(
        ordered.indexOf(reader.name),
        `${token}: without the declaration the reader must come back first — ` +
          'if this passes, case 2 was not measuring the declaration',
      ).toBeLessThan(ordered.indexOf(SETTINGS_PLUGIN));
    }
  });

  it('4. the edge is SOFT — a kernel with no settings plugin still resolves', () => {
    // `optionalDependencies` is order-if-present. A hard dependency here would
    // refuse to boot every metadata-only / lean kernel that composes email or
    // storage without a settings service.
    for (const { token, plugin } of SETTINGS_READING_ALWAYS_ON) {
      const reader = plugin();
      const registry = registryOf(engineStub(), reader);
      expect(
        () => resolvePluginOrder(registry),
        `${token}: the settings edge must not be hard`,
      ).not.toThrow();
      expect(resolvePluginOrder(registry).map((p) => p.name)).toContain(reader.name);
    }
  });
});

describe('the always-on slate mounts bind targets before everything else', () => {
  it('5. every non-foundational entry — `sms` included — comes after ALL bind targets', () => {
    // THE DERIVED BOUNDARY. Not "the first six": the rule is that the services
    // other entries bind into during `kernel:ready` are mounted first, and
    // everything else grows after them. An eleventh always-on entry added
    // tomorrow is covered by this the moment it is added, wherever it goes —
    // and one inserted BEFORE `settings` turns this red.
    for (const target of BIND_TARGETS) {
      expect(slateIndex(target), `${target} must be on the slate`).toBeGreaterThanOrEqual(0);
    }
    const lastTarget = Math.max(...BIND_TARGETS.map(slateIndex));

    const tail = PLATFORM_ALWAYS_ON_CAPABILITIES.filter(
      (c) => !(BIND_TARGETS as readonly string[]).includes(c),
    );
    // Non-vacuity: the tail is what this case is about, so an empty one is a
    // pass over nothing.
    expect(tail.length).toBeGreaterThan(0);
    for (const token of tail) {
      expect(
        slateIndex(token),
        `${token} is mounted before a service it may bind into at kernel:ready`,
      ).toBeGreaterThan(lastTarget);
    }
  });

  it('6. `sms` specifically — the entry the old `slice(0, 6)` pin stopped one short of', () => {
    // Kept as its own case because the off-by-one is the thing that reads as
    // correct at a glance. `sms` is at index 6; the pinned prefix was
    // `slice(0, 6)`, i.e. indices 0-5.
    expect(slateIndex('sms')).toBeGreaterThan(slateIndex('settings'));
    expect(slateIndex('sms')).toBeGreaterThanOrEqual(6);
  });

  it('7. every declared settings reader on the slate is mounted after `settings`', () => {
    const settingsAt = slateIndex('settings');
    expect(settingsAt).toBeGreaterThanOrEqual(0);
    for (const { token } of SETTINGS_READING_ALWAYS_ON) {
      expect(slateIndex(token), `${token} must be on the slate`).toBeGreaterThanOrEqual(0);
      expect(slateIndex(token), `${token} must be mounted after settings`).toBeGreaterThan(
        settingsAt,
      );
    }
  });

  it('8. the invariant is falsifiable — a hostile slate is reported, not shrugged off', () => {
    // The positive control for case 5's derivation. Run the SAME predicate over
    // a slate with `settings` moved to the end: it must name every reader that
    // now precedes it. A predicate that reported nothing here would report
    // nothing on a real regression either.
    const hostile = ['email', 'sms', 'storage', 'queue', 'job', 'cache', 'settings'];
    const at = (t: string) => hostile.indexOf(t);
    const lastTarget = Math.max(...BIND_TARGETS.map(at));
    const violations = hostile.filter(
      (c) => !(BIND_TARGETS as readonly string[]).includes(c) && at(c) < lastTarget,
    );
    expect(violations).toEqual(['email', 'sms', 'storage']);
  });
});
