/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Which namespace this package registers under, and who owns the bare
 * `report` / `spec-report` / `report-viewer` keys (objectui#6416).
 *
 * This package used to register all three short names under namespace
 * `report`, while `apps/console/src/register-plugins.ts` declared the lazy
 * stubs for the same three names under `plugin-report` — the spelling every
 * sibling plugin uses and the one the CLI's known-type whitelist ships. Two
 * consequences followed, and both are pinned below:
 *
 *   1. THE BARE KEY WAS DOUBLE-CLAIMED, PHASE-DEPENDENTLY. Neither site passed
 *      `skipFallback`, so both also claimed the bare key (`Registry.register`
 *      and `Registry.registerLazy` share the `meta?.namespace &&
 *      !meta?.skipFallback` branch). Before the chunk loaded, bare `report`
 *      declared namespace `plugin-report` (from the stub); after it loaded, the
 *      same key declared `report` (from this package). Which answer a host got
 *      depended on when it asked — the objectui#6353 shape.
 *   2. THE NAMESPACED KEYS WERE UNSATISFIABLE. `register()` clears the lazy
 *      stub for the type it is registering, and the type it registered was
 *      `report:report` — so `plugin-report:report` was never cleared and no
 *      component was ever stored under it. `get('report', 'plugin-report')`
 *      stayed `undefined` and `hasLazy('report', 'plugin-report')` stayed
 *      `true` forever, while `packages/cli/src/utils/known-schema-types.ts`
 *      listed all three `plugin-report:*` spellings as renderable.
 *
 * The fix is the one direction the measurement chartered: nothing in this
 * repository, and nothing in the sibling `objectstack` checkout, ever authored
 * a `report:*` spelling (0 hits), while the bare spellings are authored in 48
 * places — so the package moves to `plugin-report` and the `report:*` keys are
 * retired. Both claimants of each bare key now name the SAME full type, which
 * is the shape all 27 other console-stub/plugin pairs in this repo already
 * have, so the bare key has one owner by construction rather than by whichever
 * phase the host happened to observe.
 *
 * WHY THE REPLAY (`in EITHER registration order`): asserting only today's
 * resolved outcome cannot tell "declared" apart from "happened to be observed
 * after the right step". The replay reads this package's REAL declared
 * metadata back out of the registry — nothing here is a hand-copied mirror of
 * `../index` — re-registers it into a fresh `Registry` alongside a
 * console-shaped lazy stub, in both orders, and checks the bare key's declared
 * namespace after EVERY step. Order- and phase-independence are then
 * properties under test rather than properties of the file this test imports.
 *
 * The cross-site half — that `apps/console` and the generated CLI whitelist
 * really do spell it `plugin-report` — is pinned from the repo's own
 * registration derivation in
 * `scripts/__tests__/report-namespace-agreement-6416.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { ComponentRegistry, Registry, type ComponentMeta } from '@object-ui/core';
// Importing the package entry is what performs every registration, exactly
// as a host does. The renderers are compared by IDENTITY below, so these pins
// cannot be satisfied by a look-alike.
import { ReportRenderer, ReportViewer } from '../index';

/**
 * The consumer-facing spelling: what `apps/console` declares for its lazy
 * stubs and what the CLI whitelist ships. It is stated rather than read out of
 * this package's own metadata on purpose — deriving it from the thing under
 * test would make the comparison circular.
 */
const NS = 'plugin-report';

/**
 * The short names this package registers, and the renderer each owns. Two since
 * objectui#11440 retired the `spec-report` alias of `report`, which the row at
 * the foot of this file holds unregistered.
 */
const REGISTRATIONS: Array<[short: string, renderer: unknown]> = [
  ['report', ReportRenderer],
  ['report-viewer', ReportViewer],
];

const COLLISION_WARNING = 'bare-name fallback is being overwritten';

/** Every LOADED namespaced key whose short name is `short`. */
function namespacedKeysFor(short: string): string[] {
  return ComponentRegistry.getAllTypes()
    .filter((t) => t.includes(':') && t.slice(t.indexOf(':') + 1) === short)
    .sort();
}

/**
 * The registration this package actually declared — component plus meta, read
 * back from the registry rather than restated here.
 *
 * The lookup deliberately does NOT pass `NS`: it finds the namespaced key by
 * short name and reports whatever namespace was declared. Asking for
 * `getConfig(short, NS)` instead would presuppose the answer, and the replay's
 * per-step namespace check below could then never fail — it would be reading a
 * value it had already selected for.
 */
function declaredRegistration(short: string): { component: unknown; meta: ComponentMeta } {
  const keys = namespacedKeysFor(short);
  expect(
    keys,
    `"${short}" must have exactly one namespaced spelling for the replay to mean anything`,
  ).toHaveLength(1);
  // `type` is the FULL type (`ns:name`); `register` re-derives it from the bare
  // name + namespace, so replaying it would double the prefix.
  const config = ComponentRegistry.getConfig(keys[0]);
  expect(config, `nothing is registered as "${keys[0]}"`).toBeDefined();
  const { type: _fullType, component, ...meta } = config!;
  return { component, meta: meta as ComponentMeta };
}

/** The lazy stub `apps/console/src/register-plugins.ts` declares for `short`. */
function consoleStubMeta(): ComponentMeta {
  return { namespace: NS, category: 'view' } as ComponentMeta;
}

describe('plugin-report registers under the namespace its consumers declare', () => {
  it.each(REGISTRATIONS)(
    '"%s" is registered under exactly one namespace, and it is plugin-report',
    (short) => {
      expect(
        namespacedKeysFor(short),
        `"${short}" must be registered as "${NS}:${short}" and nothing else — a second ` +
          'namespaced spelling is a key the CLI whitelist and the console stubs cannot ' +
          'both satisfy (objectui#6416)',
      ).toEqual([`${NS}:${short}`]);
    },
  );

  it('no `report:*` key survives — that spelling is retired', () => {
    expect(ComponentRegistry.getAllTypes().filter((t) => t.startsWith('report:'))).toEqual([]);
  });

  it.each(REGISTRATIONS)(
    '"%s" resolves to its renderer by BOTH the bare and the namespaced key',
    (short, renderer) => {
      // The namespaced lookup is the one the console stub and the CLI whitelist
      // name; before this fix it was `undefined` for all three.
      expect(ComponentRegistry.get(short, NS)).toBe(renderer);
      // The bare lookup is the only spelling anything in this repo authors.
      expect(ComponentRegistry.get(short)).toBe(renderer);
    },
  );
});

// The pin the card is actually about. Both rows replay the SAME declared
// metadata into a fresh registry; only the sequence differs. The bare key's
// declared namespace is checked after EVERY step, so a mismatch between the
// stub and the real registration reddens here even though each step on its own
// succeeds.
const ORDERS: Array<[label: string, order: Array<'stub' | 'eager'>]> = [
  ['stub first — what the console does: boot stubs, then the chunk loads', ['stub', 'eager']],
  ['eager first — a host that imports the package before declaring stubs', ['eager', 'stub']],
];

describe.each(REGISTRATIONS)(
  'bare "%s" ownership is declared, not decided by registration order',
  (short, renderer) => {
    it.each(ORDERS)('resolves the same way in EITHER order (%s)', (_label, order) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const fresh = new Registry<unknown>();
        const { component, meta } = declaredRegistration(short);

        for (const step of order) {
          if (step === 'stub') {
            fresh.registerLazy(short, () => Promise.resolve({}), consoleStubMeta());
          } else {
            fresh.register(short, component, meta);
          }
          // The invariant that used to break: whoever last touched the bare key
          // must declare the SAME namespace, at every point in the sequence.
          expect(
            fresh.getMeta(short)?.namespace,
            `after the "${step}" step in order [${order.join(', ')}], bare "${short}" declares a ` +
              'different namespace than the step before it — the bare key is double-claimed ' +
              'again (objectui#6416)',
          ).toBe(NS);
        }

        expect(
          fresh.get(short),
          `registering in the order [${order.join(', ')}] changed who answers bare "${short}"`,
        ).toBe(renderer);
        // The key the CLI whitelist declares renderable must name a real
        // component once the chunk has loaded, in either order.
        expect(fresh.get(short, NS)).toBe(renderer);

        // The registry's collision guard is the mechanism this class of fix
        // uses, so its silence is part of the contract: a warning here means two
        // registrations are fighting over the bare key again.
        const collided = warn.mock.calls.some(
          (args: unknown[]) => typeof args[0] === 'string' && args[0].includes(COLLISION_WARNING),
        );
        expect(collided, 'the registry warned that the bare-name fallback was overwritten').toBe(
          false,
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('the real registration clears the console stub instead of stranding it', () => {
      const fresh = new Registry<unknown>();
      const { component, meta } = declaredRegistration(short);
      fresh.registerLazy(short, () => Promise.resolve({}), consoleStubMeta());
      expect(fresh.hasLazy(short, NS)).toBe(true);

      fresh.register(short, component, meta);

      // Consequence 2: while the namespaces disagreed, `register()` deleted
      // `report:<short>` and left `plugin-report:<short>` pending forever, so
      // the whitelisted key was permanently unrenderable.
      expect(
        fresh.hasLazy(short, NS),
        `"${NS}:${short}" is still a pending lazy stub after the module registered — the ` +
          'registration is landing under a different full type (objectui#6416)',
      ).toBe(false);
      expect(fresh.hasLazy(short)).toBe(false);
    });
  },
);

describe('the retired `spec-report` spelling is not registered (objectui#11440)', () => {
  it('neither the bare key nor its namespaced twin resolves, while `report` does', () => {
    expect(ComponentRegistry.get('spec-report')).toBeUndefined();
    expect(ComponentRegistry.getAllTypes()).not.toContain('plugin-report:spec-report');
    // Lit control: the spelling the retirement points authors to.
    expect(ComponentRegistry.get('report')).toBe(ReportRenderer);
  });
});
