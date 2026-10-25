/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * THE UNIVERSAL containment census — declared ⇔ rendered, over the whole
 * registry, in BOTH directions (objectui#6779, re-pointed by objectui#9910).
 *
 * ## What this file pins
 *
 * A registration that puts an authored `children` list on the page declares
 * `{ name: 'children', type: 'slot' }` in its `inputs`, and ONLY that
 * declaration decides `sdui-parser`'s `not-a-container` diagnostic
 * (`acceptsChildren` in `packages/sdui-parser/src/validate.ts`). Three facts,
 * each held against the live registry rather than the source:
 *
 *   1. RENDERS ⇒ DECLARES. A renderer that puts the list on the page and
 *      declares no `children` input is a NEW violation — declare the input.
 *   2. DECLARES ⇒ RENDERS. A `children` input whose renderer never puts the
 *      list on the page — bare, or in the context it renders in — is a lie
 *      the designer would offer and the tier would bless. Delete it, or probe
 *      it in context (`CONTEXT_PROBES`).
 *   3. THE TIER READS THE INPUT AND NOTHING ELSE. `not-a-container` fires on
 *      exactly the undeclared registrations, whatever `isContainer` says.
 *
 * ## Why the predicate moved off the flag (objectui#9910)
 *
 * objectui#6779 built this census over `isContainer`, because that flag was
 * what `validateTree` read. The flag was hand-kept and it drifted from the
 * code four times (objectui#3900 / #6740 / #6764 / #6779); then objectui#6771
 * converged a dozen `schema.body` readers onto `children`, objectui#6804 had
 * ruled the flag OFF for that population (it means LAYOUT containment, and
 * declaring it deletes a public tag from every react page's JSX scope), and
 * the diagnostic landed FALSE on the one key those registrations read. The
 * maintainer ruled 2026-09-24 (objectui#9910 Q1-A, declare-and-pin): the
 * containment declaration is the `children` slot input, the tier reads only
 * it, and this census holds it both ways. `isContainer` keeps its layout
 * meaning (Q2-A) and decides nothing here — pinned below as a control.
 *
 * ## The instrument, and why it is a RUNTIME one
 *
 * objectui#6779 measured four reasons a source-side spelling of "does this
 * renderer read `schema.children`?" cannot be built: the tree's own reader
 * refuses computed keys and 41 of 53 registered from a loop variable; file
 * granularity mis-reads a file holding two registrations; WHICH registration
 * is live is a whole-program import-order fact; and "children or body" is not
 * a distinction a source predicate keeps. So the predicate is behavioural and
 * executed: render the tag through the real `SchemaRenderer` with one
 * authored child and ask whether that child reached the DOM.
 *
 * The bare probe had two blind spots, and both were handled by NAME rather
 * than skipped: a renderer that only mounted inside a provider (`sidebar`,
 * `sidebar-menu-button` needed `sidebar-provider`), and a portal that renders
 * only when open (`tooltip`). The first is gone: objectui#10859 batch 8 phase
 * 2d retired the `sidebar-*` part keys and made `sidebar` supply its own
 * provider, so it renders under the bare probe and its fixture was deleted as
 * dead weight. `CONTEXT_PROBES` renders each remaining one in its context,
 * and pins that the context is still NEEDED — a fixture whose subject starts
 * rendering bare is dead weight and goes red, the same way a baseline row
 * that stopped violating does.
 *
 * ## Population: every KNOWN key, namespaced spellings included
 *
 * objectui#6779 iterated bare tags only, on the ground that "the namespaced
 * twins are the same registration". That is true for `ui:h1` and `h1`, and
 * false for `sidebar` (the `ui` chrome part) versus `page:sidebar` (a
 * different renderer in `containers.tsx`), so a bare-only census scores
 * `page:sidebar` off `sidebar`'s row. Every known key is probed; a twin costs
 * one extra render.
 *
 * ## The ledger
 *
 * `scripts/container-declaration-baseline.json` is at ZERO — every row it
 * carried declared the slot in objectui#9910. It stays as the one place an
 * admitted violation could be recorded WITH a ruling; both maps must remain
 * consistent with the census (a listed row that does not violate is red), so
 * the file can only shrink back to empty.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, AdapterCtx } from '@object-ui/react';
import { CHILD_LIST_KEY, manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { Diagnostic, SchemaElement } from '@object-ui/sdui-parser';

// Module scope, not a hook: this import IS the registration (AGENTS.md
// §测试纪律 — an unbounded module load must not be billed to a bounded window).
import '../index';

const CONTAINMENT = 'not-a-container';
const MARK = 'ratchet-child';

/** Long enough for ~300 sequential renders under a loaded CI box. */
const CENSUS_TIMEOUT = 180_000;

/**
 * The repo root, derived from THIS FILE's own location — never from the cwd
 * (objectui#7799). Bare `import.meta.url` is a `file:` URL under both cwds
 * this suite runs from; the two-argument `new URL(rel, import.meta.url)` form
 * is what Vite rewrites, so only the bare form is read and taken apart by hand
 * (the spelling landed for objectui#7791, PR #7796).
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 6; // packages / components / src / renderers / __tests__ / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');

const BASELINE_PATH = join(REPO_ROOT, 'scripts/container-declaration-baseline.json');

interface Baseline {
  note: string[];
  excluded: Record<string, { reason: string; issue: string; since: string }>;
  undeclared: Record<string, { since: string; issue: string }>;
}

const readBaseline = (): Baseline => {
  // The existence check comes first so a moved or renamed ledger fails LOUDLY,
  // rather than as a confusing JSON parse error or — worse — as a green run
  // against an empty object.
  expect(existsSync(BASELINE_PATH), `baseline not found at ${BASELINE_PATH}`).toBe(true);
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
};

/**
 * The manifest the running app validates against, built the way the app builds
 * it — keyed by every KNOWN registry tag rather than by `getAllConfigs()`, whose
 * `.type` is always the namespaced form. Mirrors `getJsxManifest()` in
 * `renderers/layout/page.tsx`. Key it off `getAllConfigs()` instead and the bare
 * tag an author writes is absent from the manifest, so every assertion below
 * would pass on `unknown-component` without reaching the containment check.
 */
const diagnose = (schema: unknown): Diagnostic[] => {
  const configs = ComponentRegistry.getKnownTypes().map((t) => {
    const meta = ComponentRegistry.getMeta(t);
    return { type: t, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
  });
  const manifest = manifestFromConfigs(configs as unknown as Parameters<typeof manifestFromConfigs>[0]);
  return validateTree(schema as SchemaElement, manifest).diagnostics;
};

const withChildren = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  ...extra,
  children: [{ type: 'text', content: MARK }],
});

/**
 * Does rendering this schema put the authored MARK child on the page?
 *
 * `readBody` reads `document.body` instead of the render container, for the
 * one shape that renders through a portal (`tooltip`): its content is mounted
 * outside the container it was rendered into.
 */
const rendersMark = async (schema: unknown, readBody = false): Promise<boolean> => {
  const { container, unmount } = render(
    <AdapterCtx.Provider value={null as never}>
      <SchemaRenderer schema={schema as never} />
    </AdapterCtx.Provider>,
  );
  try {
    await waitFor(() => expect(container.textContent).toBeDefined());
    const text = readBody ? document.body.textContent || '' : container.textContent || '';
    return text.includes(MARK);
  } finally {
    unmount();
  }
};

/** Does this registration put an AUTHORED child list on the page, bare? */
const rendersChildren = (type: string): Promise<boolean> => rendersMark(withChildren(type));

/** Does this registration declare the containment input the tier reads? */
const declaresChildren = (type: string): boolean =>
  (ComponentRegistry.getMeta(type)?.inputs ?? []).some((input) => input.name === CHILD_LIST_KEY);

interface Row {
  type: string;
  rendersChildren: boolean;
  declaresChildren: boolean;
  isContainer: boolean;
  containment: boolean;
  unknown: boolean;
  isPublic: boolean;
}

/** Every known key, bare AND namespaced — see the population note above. */
const knownTypes = (): string[] => ComponentRegistry.getKnownTypes().slice().sort();

/** The bare authoring tags only, for the pins that speak about a bare family. */
const bareTags = (): string[] => knownTypes().filter((t) => !t.includes(':'));

const publicTags = (): Set<string> =>
  new Set((ComponentRegistry.getPublicConfigs() as Array<{ type: string }>).map((c) => c.type));

/**
 * The renderers the BARE probe cannot see, each rendered in the context it
 * really renders in (objectui#9910 measured all three on `origin/main`).
 *
 *  - `sidebar` and `sidebar-menu-button` mounted nothing outside a
 *    `sidebar-provider` (shadcn's sidebar reads its context). Both entries are
 *    gone (objectui#10859 batch 8 phase 2d): `sidebar-menu-button` and
 *    `sidebar-provider` are retired keys, and `sidebar` now mounts its own
 *    provider when none is above it, so the bare probe sees its child.
 *  - `tooltip` renders its content in a portal, and only while open; the
 *    registration spreads the node's other keys onto Radix `Tooltip`, so
 *    `open: true` is the authored way to hold it open.
 *
 * Each probe lists the KEYS it answers for (the bare tag and its `ui:` twin),
 * because the census iterates namespaced spellings too. The fixture is pinned
 * as NEEDED: if its subject starts rendering under the bare probe, the entry
 * here is dead weight and `the context probes are all still needed` goes red.
 */
interface ContextProbe {
  types: string[];
  /** The schema that puts `type` in its rendering context, with the MARK child. */
  schema: (type: string) => unknown;
  /** Read `document.body` rather than the container (portal). */
  readBody?: boolean;
}

const CONTEXT_PROBES: ContextProbe[] = [
  {
    types: ['tooltip', 'ui:tooltip'],
    schema: (type) => withChildren(type, { open: true, trigger: [{ type: 'text', content: 'trigger' }] }),
    readBody: true,
  },
];

const contextProbeFor = (type: string): ContextProbe | undefined =>
  CONTEXT_PROBES.find((probe) => probe.types.includes(type));

/**
 * Run once for the whole file. Memoised as a PROMISE rather than done in a
 * `beforeAll`, because `hookTimeout` (10s) is NARROWER than `testTimeout` and
 * ~300 renders under a loaded box do not reliably fit in it (AGENTS.md §测试纪律
 * — moving an unbounded cost into a hook only relocates the race).
 */
let censusPromise: Promise<Row[]> | undefined;

const census = (): Promise<Row[]> =>
  (censusPromise ??= (async () => {
    const isPublic = publicTags();
    const rows: Row[] = [];
    for (const type of knownTypes()) {
      const codes = diagnose(withChildren(type)).map((d) => d.code);
      rows.push({
        type,
        rendersChildren: await rendersChildren(type),
        declaresChildren: declaresChildren(type),
        isContainer: ComponentRegistry.getMeta(type)?.isContainer === true,
        containment: codes.includes(CONTAINMENT),
        unknown: codes.includes('unknown-component'),
        isPublic: isPublic.has(type),
      });
    }
    return rows;
  })());

/** Direction 1's violation: renders a child list, declares no slot for it. */
const undeclaredRenderers = (rows: Row[]): string[] =>
  rows.filter((r) => r.rendersChildren && !r.declaresChildren).map((r) => r.type);

/** Direction 2's violation under the BARE probe: declares the slot, renders nothing. */
const bareLiars = (rows: Row[]): string[] =>
  rows.filter((r) => r.declaresChildren && !r.rendersChildren).map((r) => r.type);

describe('the census is a reading, not a broken scan (objectui#6779 / objectui#9910)', () => {
  it(
    'reproduces the control set and resolves every key it scored',
    async () => {
      const rows = await census();
      const byType = new Map(rows.map((r) => [r.type, r]));

      // CONTROL ONE — the named five. objectui#6764 established the layout
      // primitives as the containers that DECLARE; under objectui#9910 the
      // declaration is the `children` slot and all five carry it AND render it.
      // Reproducing them is what makes the zeroes elsewhere a reading rather
      // than evidence that this scan resolves nothing.
      for (const control of ['flex', 'grid', 'card', 'container', 'stack']) {
        expect(byType.get(control)?.declaresChildren, `control tag \`${control}\` no longer declares the slot`).toBe(true);
        expect(byType.get(control)?.rendersChildren, `control tag \`${control}\` no longer renders children`).toBe(true);
      }

      // CONTROL TWO — reachability before absence. A tag the manifest does not
      // resolve reports `unknown-component` and never reaches the containment
      // branch, so it would score as "no violation" for the wrong reason.
      expect(rows.filter((r) => r.unknown).map((r) => r.type)).toEqual([]);

      // CONTROL THREE — the diagnostic still fires. Every registration that
      // declares NO slot must draw `not-a-container`; if the check were deleted
      // this file would otherwise go green having measured nothing at all.
      const silent = rows.filter((r) => !r.declaresChildren && !r.containment).map((r) => r.type);
      expect(silent, 'an undeclared registration stopped drawing the containment diagnostic').toEqual([]);

      // CONTROL FOUR — the census has a population, in both spellings.
      expect(rows.length).toBeGreaterThan(200);
      expect(bareTags().length).toBeGreaterThan(100);
      expect(rows.filter((r) => r.declaresChildren).length).toBeGreaterThan(60);
    },
    CENSUS_TIMEOUT,
  );
});

describe('direction 1 — every renderer that puts `children` on the page declares the slot (objectui#9910)', () => {
  it(
    'no registration renders an authored child list while declaring no `children` input',
    async () => {
      const rows = await census();
      const baseline = readBaseline();
      const admitted = new Set([...Object.keys(baseline.undeclared), ...Object.keys(baseline.excluded)]);

      // THE LOAD-BEARING ASSERTION. A registration that renders an authored
      // child list while declaring no slot for it makes `validateTree` LIE on
      // the one key its authors write, and a warning that lies is worse than a
      // missing one because it trains authors — AI authors especially — to
      // discount the TRUE `not-a-container` reports (objectui#3900's reasoning,
      // measured live on objectui#9910). Adding your tag to the baseline is NOT
      // the fix: declare `{ name: 'children', type: 'slot' }` on the registration.
      const unexpected = undeclaredRenderers(rows).filter((t) => !admitted.has(t));
      expect(
        unexpected,
        'renderer(s) put `children` on the page without declaring the slot — add `{ name: \'children\', type: \'slot\' }` to the registration `inputs`, do not list them',
      ).toEqual([]);
    },
    CENSUS_TIMEOUT,
  );
});

describe('direction 2 — every declared slot is rendered, bare or in its declared context (objectui#9910)', () => {
  it(
    'no `children` input is a lie: each is rendered bare, or by the context probe that names it',
    async () => {
      const rows = await census();
      const unexplained: string[] = [];
      for (const type of bareLiars(rows)) {
        const probe = contextProbeFor(type);
        if (!probe) {
          unexplained.push(type);
          continue;
        }
        expect(
          await rendersMark(probe.schema(type), probe.readBody),
          `\`${type}\` declares the slot but renders no child even inside its declared context`,
        ).toBe(true);
      }
      expect(
        unexplained,
        'declared `children` input(s) whose renderer never puts the list on the page — delete the input, or add a CONTEXT_PROBES entry that renders the tag where it really renders',
      ).toEqual([]);
    },
    CENSUS_TIMEOUT,
  );

  it(
    'the context probes are all still needed — a subject that renders bare makes its fixture dead weight',
    async () => {
      const rows = await census();
      const byType = new Map(rows.map((r) => [r.type, r]));
      for (const probe of CONTEXT_PROBES) {
        for (const type of probe.types) {
          const row = byType.get(type);
          expect(row, `context probe names \`${type}\`, which is not registered`).toBeTruthy();
          expect(row?.declaresChildren, `\`${type}\` no longer declares the slot — drop it from CONTEXT_PROBES`).toBe(true);
          expect(
            row?.rendersChildren,
            `\`${type}\` now renders under the bare probe — its CONTEXT_PROBES entry is dead weight, delete it`,
          ).toBe(false);
        }
      }
      // Direction control: the subject whose fixture this rule deleted. The
      // `sidebar` entry left CONTEXT_PROBES because the bare probe now SEES its
      // child (it mounts its own provider when none is above it, objectui#10859
      // batch 8 phase 2d). Asserted, so the deletion is a measured fact rather
      // than a dropped case. (The old control here, `sidebar-trigger` inside a
      // `sidebar-provider`, named two keys that phase retired.)
      for (const type of ['sidebar', 'ui:sidebar']) {
        expect(byType.get(type)?.declaresChildren, `\`${type}\` no longer declares the slot`).toBe(true);
        expect(byType.get(type)?.rendersChildren, `\`${type}\` renders no child under the bare probe`).toBe(true);
        expect(contextProbeFor(type), `\`${type}\` is back in CONTEXT_PROBES`).toBeUndefined();
      }
    },
    CENSUS_TIMEOUT,
  );
});

describe('direction 3 — the tier reads the declared input and nothing else (objectui#9910 Q1-A)', () => {
  it(
    '`not-a-container` fires on exactly the undeclared registrations, whatever `isContainer` says',
    async () => {
      const rows = await census();
      const mismatched = rows
        .filter((r) => !r.unknown && r.containment !== !r.declaresChildren)
        .map((r) => `${r.type} (declares=${r.declaresChildren}, containment=${r.containment}, isContainer=${r.isContainer})`);
      expect(mismatched, 'the containment diagnostic disagrees with the declared `children` input').toEqual([]);
    },
    CENSUS_TIMEOUT,
  );

  it(
    '⛔ `isContainer` is not a fallback: a flagged registration with no slot still draws the diagnostic',
    async () => {
      // The pin on the ruling's hard line. `page:tabs` and `page:accordion`
      // carry `isContainer: true` (they are layout containers) and render
      // `items[].children`, never `schema.children` — so a child list authored
      // under them is genuinely unrendered, and the diagnostic on it is TRUE.
      // Before objectui#9910 the flag silenced it; now nothing does.
      const rows = await census();
      const byType = new Map(rows.map((r) => [r.type, r]));
      const flaggedWithoutSlot = rows.filter((r) => r.isContainer && !r.declaresChildren).map((r) => r.type);
      expect(flaggedWithoutSlot, 'no flagged-but-undeclared registration is left to prove the flag is ignored').not.toEqual([]);
      for (const type of ['page:tabs', 'page:accordion']) {
        expect(byType.get(type)?.isContainer, `\`${type}\` dropped its layout flag`).toBe(true);
        expect(byType.get(type)?.declaresChildren, `\`${type}\` now declares a slot it does not render`).toBe(false);
        expect(byType.get(type)?.rendersChildren).toBe(false);
        expect(byType.get(type)?.containment, `\`${type}\`: the flag silenced the diagnostic — the fallback is back`).toBe(true);
      }

      // …and the other way: the slot alone is sufficient. `button` is public,
      // carries NO flag (objectui#6804 keeps it out of the react-page skip
      // set), renders `children` as its label fallback, declares the slot, and
      // draws nothing — the false diagnostic objectui#9910 was filed about is
      // gone without the flag.
      const button = byType.get('button');
      expect(button?.isContainer).toBe(false);
      expect(button?.isPublic).toBe(true);
      expect(button?.rendersChildren).toBe(true);
      expect(button?.declaresChildren).toBe(true);
      expect(button?.containment).toBe(false);
    },
    CENSUS_TIMEOUT,
  );

  it('the retired `body` spelling follows the same predicate', async () => {
    // `checkRetiredBodyDialect` is handed `acceptsChildren(comp)` — the same
    // reading the `children` branch takes — so a `body` list under a declared
    // slot is answered as a retired key (`unknown-prop`, naming `children`) and
    // under an undeclared registration as `not-a-container`, naming both.
    const rows = await census();
    const byType = new Map(rows.map((r) => [r.type, r]));
    const under = (type: string) =>
      diagnose({ type, body: [{ type: 'text', content: MARK }] } as unknown).filter((d) => d.message.includes('"body"'));

    expect(byType.get('box')?.declaresChildren).toBe(true);
    expect(under('box').map((d) => d.code)).toEqual(['unknown-prop']);

    expect(byType.get('page:tabs')?.declaresChildren).toBe(false);
    expect(byType.get('page:tabs')?.isContainer).toBe(true);
    expect(under('page:tabs').map((d) => d.code)).toEqual([CONTAINMENT]);
  }, CENSUS_TIMEOUT);
});

describe('the ruled 14 of objectui#6804 keep the flag OFF and now declare the slot (objectui#9910)', () => {
  it('`button`, `badge`, `alert` and the bare `sidebar` key (its ten `sidebar-*` parts retired)', async () => {
    const rows = await census();
    const byType = new Map(rows.map((r) => [r.type, r]));
    const isPublic = publicTags();

    // DIRECTION CONTROL, first: without it "the sidebar keys are not public" is
    // indistinguishable from "this reader returned nothing".
    expect(isPublic.size).toBeGreaterThan(0);
    expect(isPublic.has('button'), 'the public reader resolved nothing — every absence below is vacuous').toBe(true);

    // Eleven until objectui#10859 batch 8 phase 2d retired the ten `sidebar-*`
    // part keys; `sidebar` is the one left of the family the ruling named.
    const sidebars = bareTags().filter((t) => t.startsWith('sidebar'));
    expect(sidebars, 'the `sidebar*` family changed — re-measure this block').toEqual(['sidebar']);
    const ruled = ['button', 'badge', 'alert', ...sidebars];

    for (const type of ruled) {
      // (a) objectui#6804's ruling, still held: none of them is a LAYOUT
      // container. Declaring the flag on the three public ones would delete
      // `Button` / `Badge` / `Alert` from every react page's JSX scope.
      expect(byType.get(type)?.isContainer, `\`${type}\` declared \`isContainer\` — that overrides objectui#6804`).toBe(false);
      // (b) the retired spelling is still ANSWERED, and the answer names the
      // remedy. ⛔ Not "draws nothing": silence on a retired key is the state
      // objectui#6771 exists to end.
      const messages = diagnose({ type, body: [{ type: 'text', content: MARK }] } as unknown).map((d) => d.message);
      expect(
        messages.some((m) => m.includes('"body"') && m.includes('"children"')),
        `\`${type}\` does not name \`children\` when an author writes the retired \`body\``,
      ).toBe(true);
    }

    // (c) THE FLIP. Every one of them that renders `children` — bare or in
    // context — declares the slot and draws NO `not-a-container` for it.
    // This is the refusal pin objectui#6771 left here, inverted into the truth
    // the objectui#9910 ruling ordered: the false warning on the one key these
    // registrations read is gone, and it is gone WITHOUT the flag.
    const renderers = ruled.filter((t) => byType.get(t)?.rendersChildren || contextProbeFor(t));
    // All four. Thirteen of fourteen until objectui#10859 batch 8 phase 2d: the
    // one that read no children, `sidebar-trigger`, retired with the parts.
    expect(renderers).toEqual(ruled);
    for (const type of renderers) {
      expect(byType.get(type)?.declaresChildren, `\`${type}\` renders children and declares no slot`).toBe(true);
      expect(byType.get(type)?.containment, `\`${type}\` still draws the false \`not-a-container\``).toBe(false);
    }

    // (d) The public tier of these is THREE, and the public sidebar is
    // the namespaced registration, which keeps its layout flag: it is not in
    // this story, and a reader who finds `page:sidebar` in `PUBLIC_BLOCKS` must
    // not conclude the bare family is public too.
    expect(['button', 'badge', 'alert'].filter((t) => byType.get(t)?.isPublic).length).toBe(3);
    expect(sidebars.filter((t) => byType.get(t)?.isPublic)).toEqual([]);
    expect(isPublic.has('page:sidebar')).toBe(true);
    expect(byType.get('page:sidebar')?.isContainer).toBe(true);
    expect(byType.get('page:sidebar')?.declaresChildren).toBe(true);
  }, CENSUS_TIMEOUT);
});

describe('the ledger is at zero and stays consistent with the census (objectui#6779 / objectui#9910)', () => {
  it(
    'every listed row still violates — a row that no longer violates is dead weight and fails',
    async () => {
      const rows = await census();
      const violating = new Set(undeclaredRenderers(rows));
      const baseline = readBaseline();
      const stale = [...Object.keys(baseline.undeclared), ...Object.keys(baseline.excluded)].filter(
        (t) => !violating.has(t),
      );
      expect(stale, 'these rows no longer violate — delete them (the ledger may only shrink)').toEqual([]);
    },
    CENSUS_TIMEOUT,
  );

  it('carries the shrink-only contract in its own note, and the new predicate', () => {
    // A reader who opens the file must not be able to mistake it for an
    // exemption list, nor read it as still keyed on the flag.
    const note = readBaseline().note.join(' ');
    expect(note).toContain('RATCHET TO ZERO, NOT AN');
    expect(note).toContain('red in BOTH directions');
    expect(note).toContain("{ name: 'children', type: 'slot' }");
    expect(note).toContain('`isContainer` is no longer a way to pay a row off');
  });

  it('dates and owns every admitted row, and grounds every excluded one', () => {
    // An entry needs a ruling: `undeclared` rows carry the date and the owning
    // issue, `excluded` rows carry their ground. Empty maps are the ruled
    // state; the shape is asserted so a future admission cannot ride in bare.
    const baseline = readBaseline();
    for (const [type, entry] of Object.entries(baseline.undeclared)) {
      expect(entry.since, `\`${type}\` has no \`since\` date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.issue, `\`${type}\` has no owning issue`).toMatch(/^objectui#\d+$/);
    }
    for (const [type, entry] of Object.entries(baseline.excluded)) {
      expect(entry.issue, `\`${type}\` names no ruling`).toMatch(/^objectui#\d+$/);
      expect(entry.reason.length, `\`${type}\` carries no ground`).toBeGreaterThan(200);
    }
  });
});
