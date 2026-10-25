/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Which namespace this package registers the dashboard renderer under, who owns
 * the bare `dashboard` key, and what an authored `view:dashboard` gets now
 * (objectui#9533 — director summon #24, batch #152 item 5, letter 1,
 * maintainer-approved).
 *
 * ## The two consequences this pins, both of them MEASURED before the fix
 *
 * `apps/console` declares its lazy stubs for bare `dashboard` under
 * `plugin-dashboard` (two `registerLazy` loops), and this package used to
 * register the renderer as `view:dashboard`. Neither site passed `skipFallback`,
 * so both also claimed the bare key — `Registry.register` and
 * `Registry.registerLazy` share the `meta?.namespace && !meta?.skipFallback`
 * branch. The reproduction against a real `Registry`, run before any of this
 * landed, read:
 *
 *   1. THE BARE KEY WAS DOUBLE-CLAIMED, PHASE-DEPENDENTLY. After the stub step,
 *      bare `dashboard` declared namespace `plugin-dashboard`; after the chunk
 *      loaded, the same key declared `view`. Which answer a host got depended on
 *      when it asked — objectui#6416's shape, in that card's own words.
 *   2. THE NAMESPACED STUB WAS NEVER CLEARED. `register()` clears the lazy stub
 *      of the type IT registers, and that type was `view:dashboard` — so
 *      `hasLazy('dashboard', 'plugin-dashboard')` read `true` AFTER the package
 *      had fully loaded and `get('dashboard', 'plugin-dashboard')` read
 *      `undefined`, while the generated CLI whitelist listed that spelling as
 *      renderable. A node authored with it could only ever paint
 *      `Loading plugin-dashboard:dashboard…` forever: `Registry.loadLazy`
 *      resolves whether or not the loaded module registered the expected type,
 *      and `SchemaRenderer` re-checks `hasLazy` on every pass. That is the
 *      objectui#8760 shape, which graded a key that passes every authoring check
 *      and fails only in front of a user as the wrong side of the line.
 *
 * ## WHY THE REPLAY (`in EITHER registration order`)
 *
 * Borrowed whole from `report-bare-key-ownership.test.ts` (objectui#6416) and
 * `timeline-bare-key-ownership.test.ts` (objectui#6353): asserting only today's
 * resolved outcome cannot tell "declared" apart from "happened to be observed
 * after the right step". The replay reads this package's REAL declared metadata
 * back out of the registry — nothing here is a hand-copied mirror of `../index`
 * — re-registers it into a fresh `Registry` alongside a console-shaped lazy
 * stub, in both orders, and checks the bare key's declared namespace after EVERY
 * step. Order- and phase-independence are then properties under test rather than
 * properties of the file this test imports.
 *
 * ## The refusal is asserted WITH its text, deliberately
 *
 * A retirement pin that asserts only "the dashboard did not render" passes
 * identically against a registration that was simply deleted, which is the one
 * outcome the ruling refuses (⛔ not a silent fall-through). So the authored
 * `view:dashboard` case renders through the real SDUI host and asserts the
 * REFUSAL plus the tombstone's own migration text — read from the table the
 * component reads, never restated here.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ComponentRegistry, Registry, type ComponentMeta } from '@object-ui/core';
// Importing the package entry is what performs the registrations, exactly as a
// host does. The renderer is compared by IDENTITY below, so these pins cannot be
// satisfied by a look-alike.
import {
  DashboardRenderer,
  RETIRED_DASHBOARD_NODE_TYPES,
  RetiredDashboardNodeTombstone,
  resetRetiredDashboardNodeTypeReports,
} from '../index';

afterEach(cleanup);

/**
 * The consumer-facing spelling: what `apps/console`'s two `registerLazy` loops
 * declare and what the CLI whitelist ships. Stated rather than read out of this
 * package's own metadata on purpose — deriving it from the thing under test
 * would make the comparison circular.
 */
const NS = 'plugin-dashboard';

/** The namespace the renderer used to publish under, now a tombstone. */
const RETIRED_NS = 'view';

/** The one short name this card is about. */
const SHORT = 'dashboard';

const COLLISION_WARNING = 'bare-name fallback is being overwritten';

/** Every LOADED namespaced key whose short name is `SHORT`. */
function namespacedKeysFor(short: string): string[] {
  return ComponentRegistry.getAllTypes()
    .filter((t) => t.includes(':') && t.slice(t.indexOf(':') + 1) === short)
    .sort();
}

/**
 * The registration this package actually declared for a given FULL type —
 * component plus meta, read back from the registry rather than restated here.
 *
 * `type` is dropped because `register` re-derives it from the bare name plus the
 * namespace; replaying it would double the prefix.
 */
function declaredRegistration(fullType: string): { component: unknown; meta: ComponentMeta } {
  const config = ComponentRegistry.getConfig(fullType);
  expect(config, `nothing is registered as "${fullType}"`).toBeDefined();
  const { type: _fullType, component, ...meta } = config!;
  return { component, meta: meta as ComponentMeta };
}

/** The lazy stub both `apps/console` loops declare for this key. */
function consoleStubMeta(): ComponentMeta {
  return { namespace: NS, category: 'view' } as ComponentMeta;
}

describe('the dashboard renderer registers under the namespace its consumers declare', () => {
  it('bare `dashboard` has exactly two namespaced spellings: the live one and the tombstone', () => {
    // Both halves in one assertion so neither can drift: a third namespaced
    // spelling is a key the console stubs and the CLI whitelist cannot both
    // satisfy, and a MISSING tombstone is a silent fall-through.
    expect(namespacedKeysFor(SHORT)).toEqual([`${NS}:${SHORT}`, `${RETIRED_NS}:${SHORT}`]);
  });

  it('the whitelisted `plugin-dashboard:dashboard` key names the real renderer', () => {
    // Consequence 2, from the consumer's side: this lookup read `undefined`
    // before the fix, for the whole life of the process.
    expect(ComponentRegistry.get(SHORT, NS)).toBe(DashboardRenderer);
  });

  it('the bare key resolves to the renderer, and declares the consumers‘ namespace', () => {
    expect(ComponentRegistry.get(SHORT)).toBe(DashboardRenderer);
    expect(ComponentRegistry.getMeta(SHORT)?.namespace).toBe(NS);
  });

  it('`view:dashboard` resolves to the TOMBSTONE, not to the renderer', () => {
    const answered = ComponentRegistry.get(SHORT, RETIRED_NS);
    expect(answered).toBe(RetiredDashboardNodeTombstone);
    // Stated as its own assertion rather than inferred from the one above: the
    // failure this guards is the registration moving back, and "is not the
    // renderer" is the sentence that fails then.
    expect(answered).not.toBe(DashboardRenderer);
  });
});

// The pin the card is actually about. Both rows replay the SAME declared
// metadata into a fresh registry; only the sequence differs. The bare key's
// declared namespace is checked after EVERY step, so a mismatch between the stub
// and the real registration reddens here even though each step on its own
// succeeds.
const ORDERS: Array<[label: string, order: Array<'stub' | 'eager' | 'tombstone'>]> = [
  [
    'stub first — what the console does: boot stubs, then the chunk loads',
    ['stub', 'eager', 'tombstone'],
  ],
  [
    'eager first — a host that imports the package before declaring stubs',
    ['eager', 'tombstone', 'stub'],
  ],
];

describe('bare `dashboard` ownership is declared, not decided by registration order', () => {
  it.each(ORDERS)('resolves the same way in EITHER order (%s)', (_label, order) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fresh = new Registry<unknown>();
      const live = declaredRegistration(`${NS}:${SHORT}`);
      const tombstone = declaredRegistration(`${RETIRED_NS}:${SHORT}`);

      for (const step of order) {
        if (step === 'stub') {
          fresh.registerLazy(SHORT, () => Promise.resolve({}), consoleStubMeta());
        } else if (step === 'eager') {
          fresh.register(SHORT, live.component as never, live.meta);
        } else {
          fresh.register(SHORT, tombstone.component as never, tombstone.meta);
        }
        // The invariant that used to break: whoever last touched the bare key
        // must declare the SAME namespace, at every point in the sequence. The
        // tombstone step is in the sequence precisely because it must NOT move
        // this reading — that is what its `skipFallback: true` buys.
        expect(
          fresh.getMeta(SHORT)?.namespace,
          `after the "${step}" step in order [${order.join(', ')}], bare "${SHORT}" declares a ` +
            'different namespace than the step before it — the bare key is double-claimed again ' +
            '(objectui#9533)',
        ).toBe(NS);
      }

      expect(
        fresh.get(SHORT),
        `registering in the order [${order.join(', ')}] changed who answers bare "${SHORT}"`,
      ).toBe(DashboardRenderer);
      // The key the CLI whitelist declares renderable must name a real component
      // once the chunk has loaded, in either order.
      expect(fresh.get(SHORT, NS)).toBe(DashboardRenderer);
      // And the retired spelling answers the tombstone in either order.
      expect(fresh.get(SHORT, RETIRED_NS)).toBe(RetiredDashboardNodeTombstone);

      // The registry's collision guard is the mechanism this class of fix uses,
      // so its silence is part of the contract: a warning here means two
      // registrations are fighting over the bare key again. ⚠️ Silence is also
      // the PRE-fix reading for this particular card — `registerLazy` has no
      // collision check at all — which is why it is asserted alongside the
      // namespace readings above rather than on its own.
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

  it('the real registration CLEARS the console stub instead of stranding it', () => {
    const fresh = new Registry<unknown>();
    const live = declaredRegistration(`${NS}:${SHORT}`);
    fresh.registerLazy(SHORT, () => Promise.resolve({}), consoleStubMeta());
    // Non-vacuity: the stub really is pending before the load, so the assertion
    // below measures a transition rather than an absence.
    expect(fresh.hasLazy(SHORT, NS)).toBe(true);

    fresh.register(SHORT, live.component as never, live.meta);

    // Consequence 2. While the namespaces disagreed, `register()` deleted
    // `view:dashboard` and left `plugin-dashboard:dashboard` pending FOREVER, so
    // the whitelisted key was permanently unrenderable.
    expect(
      fresh.hasLazy(SHORT, NS),
      `"${NS}:${SHORT}" is still a pending lazy stub after the module registered — the ` +
        'registration is landing under a different full type (objectui#9533)',
    ).toBe(false);
    expect(fresh.hasLazy(SHORT)).toBe(false);
  });

  it('the LIVE registry the package loaded into holds no pending dashboard stub either', () => {
    // The replay above proves the property; this proves it of the process every
    // other test in this package shares, which is the registry a host gets.
    expect(ComponentRegistry.hasLazy(SHORT, NS)).toBe(false);
    expect(ComponentRegistry.hasLazy(SHORT)).toBe(false);
    expect(ComponentRegistry.hasLazy(SHORT, RETIRED_NS)).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * The retired spelling is refused BY NAME, with its migration
 * ══════════════════════════════════════════════════════════════════════════ */

/** Answers empty so nothing lands in an error state of its own. */
const ADAPTER = {
  find: async () => [],
  findOne: async () => null,
  aggregate: async () => [],
  count: async () => 0,
  getObject: async () => null,
  queryDataset: async () => ({ rows: [] }),
};

function renderNode(type: string): void {
  render(
    <SchemaRendererProvider dataSource={ADAPTER as never}>
      <SchemaRenderer schema={{ type, widgets: [] } as never} dataSource={ADAPTER as never} />
    </SchemaRendererProvider>,
  );
}

describe('an authored `view:dashboard` is refused by name (objectui#9533)', () => {
  it('renders the tombstone, carrying the migration text the table declares', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    resetRetiredDashboardNodeTypeReports();
    try {
      renderNode(`${RETIRED_NS}:${SHORT}`);

      const alert = screen.getByTestId('dashboard-retired-node-tombstone');
      expect(alert).toHaveAttribute('role', 'alert');
      expect(alert).toHaveAttribute('data-retired-node-type', `${RETIRED_NS}:${SHORT}`);

      // ⭐ The refusal is the assertion most easily faked, so the TEXT is
      // asserted, not merely the absence of a dashboard. Read from the table the
      // component reads — a restated copy here would go stale silently.
      const prescription = RETIRED_DASHBOARD_NODE_TYPES[SHORT];
      expect(prescription, 'the retirement table lost its entry').toBeTruthy();
      expect(alert).toHaveTextContent(`${RETIRED_NS}:${SHORT}`);
      expect(alert).toHaveTextContent(`${NS}:${SHORT}`);
      expect(alert.textContent).toBe(prescription);

      // The log half carries the same string, so a headless host sees it too.
      expect(error).toHaveBeenCalledWith(prescription);

      // ⛔ And it is a REFUSAL, not a degraded render: the widget grid the real
      // renderer paints must be absent. Asserted alongside the text above, never
      // instead of it — this half alone passes against a deleted registration.
      expect(document.querySelector('.grid.auto-rows-min')).toBeNull();
    } finally {
      error.mockRestore();
    }
  });

  it('CONTROL: the surviving spellings still paint the real dashboard', () => {
    // Non-vacuous on its own: without this, the assertion above would pass
    // against a package that renders nothing at all.
    for (const type of [SHORT, `${NS}:${SHORT}`]) {
      renderNode(type);
      expect(
        document.querySelector('.grid.auto-rows-min'),
        `"${type}" stopped resolving to the dashboard renderer`,
      ).not.toBeNull();
      expect(screen.queryByTestId('dashboard-retired-node-tombstone')).toBeNull();
      cleanup();
    }
  });
});
