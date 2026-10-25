// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#6071 — an exclusion reason that claims "no renderer" must be TRUE.
 *
 * ## The drift this closes
 *
 * `PALETTE_EXCLUSIONS` was made an explicit ledger (#2943) so a palette
 * decision is recorded where the next reader will find it. `block-config.
 * test.ts` enforces that every exclusion CARRIES a reason (`reason.length >
 * 10`); nothing enforced that the reason is TRUE. Two of them drifted: the
 * entries for `element:text_input` and `element:record_picker` opened with "no
 * renderer" while both types have had a registered renderer under
 * `namespace: 'element'` all along. The cost is not cosmetic — the ledger is
 * read as the decision record, and #5837 had to re-derive registration state
 * from source precisely because the stated reason could not be trusted.
 *
 * Correcting the two strings fixes today's text. This file pins the CLASS, so
 * the next "no renderer" written over a type that has one fails here instead of
 * being believed for another release.
 *
 * ## Why the assertion is shaped this way
 *
 * The interesting direction is cheap to get wrong. Four hazards, each with its
 * own guard below:
 *
 *  1. **A degenerate (empty) registry passes every negative assertion.** If the
 *     renderer packages were never imported, `ComponentRegistry.get(...)` is
 *     `undefined` for EVERYTHING and "no exclusion claiming no-renderer has a
 *     renderer" holds vacuously — a green that measures nothing. So each
 *     side-effect import below carries a POSITIVE probe proving that package's
 *     registrations actually ran (the same discipline `palette-discussion-
 *     alias.test.tsx` states in its own header: every negative pin carries its
 *     positive half).
 *  2. **A vacuous loop.** If someone reworded every reason so none claims "no
 *     renderer" any more, the class assertion would iterate over nothing and
 *     stay green while the guard silently stopped guarding. `the ledger still
 *     contains a no-renderer claim to check` fails in that case.
 *  3. **Scope is bounded by the import set.** A renderer registered in a
 *     package NOT imported here reads as unregistered, which would let a false
 *     "no renderer" pass.
 *  4. **The import set drifting behind the registrations** — hazard 3 coming
 *     true silently, which is what objectui#7117 measured and what the last
 *     guard below now refuses. See the next section.
 *
 * ## objectui#7117 — the import set had already drifted, and nothing said so
 *
 * Hazard 3 was stated in prose here ("widen the set when a new package starts
 * registering page blocks") and prose was not enough. `app-shell` became such a
 * package twice — #6757 (`global:search`, `global:notifications`) and #7091
 * (`app:launcher`, `nav:menu`) — and the set was not widened either time, so
 * for two ledger keys this file could not see a renderer that exists. Measured
 * on `44ea62d29`: setting `PALETTE_EXCLUSIONS['app:launcher']` to
 * `'no renderer ZZMUTZZ'` — a string that DOES match {@link CLAIMS_NO_RENDERER}
 * — still passed 4/4, while `views/app-launcher-renderer.tsx` registers a
 * renderer for it. A guard passing the exact false claim it exists to refuse.
 *
 * Two things follow, and the second is the one that keeps this from recurring:
 *
 *  - The set is widened to every package that registers a renderer for a
 *    CURRENT ledger key: the six `views/*-renderer.tsx` leaves of this package,
 *    and `@object-ui/plugin-detail` (which registers `record:chatter` — blind
 *    here for the same reason, measured the same way).
 *  - The app-shell half of the import set is CHECKED rather than trusted. `the
 *    import set covers every page block app-shell registers` derives the leaf
 *    list from the directory and fails when a leaf is not imported here — so
 *    the seventh renderer leaf reds this file instead of quietly shrinking its
 *    coverage. A hand-maintained list is exactly what drifted; deriving it is
 *    the point.
 *
 * Why the leaves and not the package barrel: `../../../../index.js` would track
 * the package automatically, but it costs 6105ms to load against 553ms for the
 * leaves (measured on `44ea62d29`, same harness) because it drags the console,
 * marketplace, cloud and diagnostics graphs in with it. This file is a
 * pure-logic gate in the cheap `unit` project, whose whole design point is not
 * paying for graphs it does not touch (`vitest.config.mts`). The derived guard
 * buys the barrel's one real advantage — tracking the package — for 0ms.
 *
 * ## What is deliberately NOT imported
 *
 * `registerPlaceholders()`. It registers the whole `PROTOCOL_COMPONENTS`
 * vocabulary against `PlaceholderRenderer` under `namespace:
 * 'protocol-placeholder'`, which would make this file answer "has a renderer"
 * for types that have only the dashed "Component Placeholder" scaffold —
 * `user:profile` was the measured example, until `@objectstack/spec` 17.3.0
 * retired the type from `PageComponentType` and objectui#7122 dropped its
 * placeholder registration with it. The MECHANISM is unchanged and so is the
 * refusal to opt in; only the illustration went, and it is left named here
 * because it is the reading the argument was built on. This repo's own
 * language is clear that the
 * scaffold is not a renderer: `views/app-launcher-renderer.tsx` describes the
 * state before it existed as "nothing rendered it, so a page that authored it
 * drew a dashed box", with placeholders registered the whole time. Opting in
 * would make the guard assert a falsehood in the opposite direction.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
// Side-effect imports: these register the components under test. The app-shell
// test setup does not pull them in, and relying on another suite having
// imported one first would make this file order-dependent.
import '@object-ui/components';
import '@object-ui/plugin-chatbot';
import '@object-ui/plugin-form';
// `record:chatter` is a ledger key whose renderer lives here (registered
// alongside `record:discussion` against the same component). Both sibling
// suites in this directory already import it for the same reason.
import '@object-ui/plugin-detail';
// This package's own page-block registrations (#6757, #7091). All six
// `views/*-renderer.tsx` leaves, not just the two currently in the ledger:
// which of them the ledger names is a palette decision that has moved before,
// and `the import set covers every page block app-shell registers` below holds
// this list to the directory.
import '../../../app-launcher-renderer.js';
import '../../../global-notifications-renderer.js';
import '../../../global-search-renderer.js';
import '../../../nav-menu-renderer.js';
import '../../../record-approval-decision-renderer.js';
import '../../../record-approvals-renderer.js';
import '../../../record-attachments-renderer.js';
import { PALETTE_EXCLUSIONS } from '../block-types';

/**
 * A reason "claims no renderer" when its text says the type has none —
 * `no renderer`, `no inline renderer`, `has no renderer`. Deliberately loose on
 * the qualifier and anchored on the noun, so a reworded claim is still caught.
 */
const CLAIMS_NO_RENDERER = /\bno\s+(?:\w+\s+){0,2}renderer\b/i;

const claimingNoRenderer = Object.entries(PALETTE_EXCLUSIONS).filter(([, reason]) =>
  CLAIMS_NO_RENDERER.test(reason),
);

/** Where this package keeps its page-block registrations, one block per file. */
const VIEWS_DIR = new URL('../../../', import.meta.url);

/**
 * The page blocks this package registers, derived from the leaf files rather
 * than restated — see the header. `register('menu', C, { namespace: 'nav' })`
 * writes the key `nav:menu`, so the two captures spell the key the ledger and
 * the registry both use.
 */
const appShellRegistrations = readdirSync(VIEWS_DIR)
  .filter((f) => f.endsWith('-renderer.tsx'))
  .map((file) => {
    const src = readFileSync(new URL(file, VIEWS_DIR), 'utf8');
    const m = /ComponentRegistry\.register\(\s*'([^']+)'[\s\S]{0,400}?namespace:\s*'([^']+)'/.exec(src);
    return { file, key: m ? `${m[2]}:${m[1]}` : null };
  });

describe('objectui#6071 — PALETTE_EXCLUSIONS reasons that claim "no renderer"', () => {
  it('the registry under test is actually populated (guards a vacuous green)', () => {
    // One probe per side-effect import above. If any of these is falsy the
    // negative assertion below proves nothing, so it must fail LOUDLY here
    // rather than passing quietly there. (The six app-shell leaves get their
    // probes from the derived guard below, which cannot be forgotten.)
    expect(
      ComponentRegistry.get('element:text'),
      '@object-ui/components did not register — every "not registered" check below would pass vacuously',
    ).toBeTruthy();
    expect(
      ComponentRegistry.get('chatbot'),
      '@object-ui/plugin-chatbot did not register — the AI surface is not actually covered',
    ).toBeTruthy();
    expect(
      ComponentRegistry.get('object-form'),
      '@object-ui/plugin-form did not register — the form family is not actually covered',
    ).toBeTruthy();
    expect(
      ComponentRegistry.get('record:chatter'),
      '@object-ui/plugin-detail did not register — `record:chatter` is a ledger key and would read as unregistered',
    ).toBeTruthy();
  });

  it('the import set covers every page block app-shell registers (objectui#7117)', () => {
    // The guard the prose maintenance rule failed to be. A new
    // `views/<block>-renderer.tsx` that this file does not import reads as
    // unregistered, which is precisely how #6757 and #7091 left two ledger keys
    // unguarded for two releases.
    //
    // Control first: a derivation that finds nothing would pass every check
    // under it vacuously, and this file's whole subject is a guard that stopped
    // seeing its population.
    expect(
      appShellRegistrations.length,
      'no views/*-renderer.tsx leaves were found — this coverage check has stopped checking',
    ).toBeGreaterThan(0);
    expect(
      appShellRegistrations.filter((r) => r.key === null).map((r) => r.file),
      'a renderer leaf whose ComponentRegistry.register(...) call could not be read — the key below cannot be derived',
    ).toEqual([]);
    // Anchor the derivation on the two keys objectui#7117 measured, so a
    // regex that silently stops matching cannot leave this green.
    expect(
      appShellRegistrations.map((r) => r.key),
      'the derived registration list no longer contains the keys #7117 was filed about',
    ).toEqual(expect.arrayContaining(['app:launcher', 'global:notifications']));

    for (const { file, key } of appShellRegistrations) {
      expect(
        ComponentRegistry.get(key as string),
        `views/${file} registers '${key}' and this file does not import it, so '${key}' reads as UNREGISTERED here. ` +
          "Add `import '../../../" +
          file.replace(/\.tsx$/, '.js') +
          "';` to the side-effect imports above. Until then, an exclusion reason claiming " +
          `'no renderer' over '${key}' would pass this suite — the defect objectui#7117 filed.`,
      ).toBeTruthy();
    }
  });

  it('the ledger\'s no-renderer population is EMPTY, and why (guards a vacuous loop)', () => {
    // This row asserted the population was non-empty, and said that an empty one
    // "should be a decision rather than a silent green". It emptied by a
    // retirement, not a rewording: its last member, `ai:chat_window`, left the
    // ledger when `@objectstack/spec` 17.7.0 retired the type upstream
    // (objectui#11717), because an exclusion must name a real spec type. So the
    // emptiness is asserted here, with its cause, rather than left silent: the
    // loop below runs over nothing until a new reason claims "no renderer", and
    // that reason turns this row red, so the guard is re-armed by name.
    expect(
      claimingNoRenderer.map(([type]) => type),
      'an exclusion claims "no renderer" again — the loop below checks it now; restore the non-empty guard',
    ).toEqual([]);
    expect(PALETTE_EXCLUSIONS['ai:chat_window']).toBeUndefined();
  });

  it('no exclusion whose reason claims "no renderer" actually has one', () => {
    for (const [type, reason] of claimingNoRenderer) {
      // `register(type, c, { namespace: n })` writes the map key `n:type`, and
      // `get(type)` with no namespace argument looks up that literal key
      // (core/src/registry/Registry.ts) — so this is the same question the
      // reason string is answering, asked of the runtime registry.
      expect(
        ComponentRegistry.get(type),
        `PALETTE_EXCLUSIONS['${type}'] says ${JSON.stringify(reason)}, but a renderer IS registered for it. ` +
          'The exclusion may well still be right — reword the reason to the real rationale (as #6071 did for ' +
          '`element:text_input` and `element:record_picker`) instead of claiming a renderer status that is false.',
      ).toBeFalsy();
    }
  });

  it('the two corrected entries do have renderers, which is what makes their new wording true', () => {
    // The other direction of the same fact. Their reasons now say they RENDER
    // but are not page content; if a later change unregistered them, that text
    // would be false in the opposite direction and this catches it.
    for (const type of ['element:text_input', 'element:record_picker']) {
      expect(
        ComponentRegistry.get(type),
        `${type} is no longer registered — its exclusion reason says it renders`,
      ).toBeTruthy();
      expect(PALETTE_EXCLUSIONS[type], `${type} must stay excluded — #6071 changed text, not decisions`).toBeTruthy();
    }
  });
});
