// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 D4 / option B — **the acceptance pin for the reader program**
 * (#15004, card 1/4; the program was ruled on #14512 comment 5528589044,
 * maintainer 2026-09-03, decision batch #23).
 *
 * ## What option B is, and what its failure mode is
 *
 * A multi-package artifact today serializes every definition TWICE: once
 * flattened to the top level, once inside `packages[i].manifest`. Option B
 * removes the flattened copy, so `packages[]` carries each definition exactly
 * once. The ruled order is **readers first, emitter last** — every reader
 * learns to resolve `packages[]` while the artifact stays additive, and only
 * then does `composeStacks` stop emitting the flat copy.
 *
 * The failure mode that order exists to contain is **a reader nobody
 * enumerated**, and it is not hypothetical: the enumeration missed sites twice
 * (#14512 comments 5523603341 and 5523741937), the second time including one in
 * `@objectstack/plugin-security`, a package nobody had scoped. The symptom is
 * SILENT. Nothing throws. The collection is simply absent, so a multi-package
 * artifact boots clean having lost its declarative actions, its scheduled jobs,
 * its seed data, its object routing or its default permission set.
 *
 * This file is the thing that makes that loud. In the ruling's own words, *"the
 * reader half does not land without it."*
 *
 * ## How it works
 *
 * `option-b-collection-zoo.ts` composes two ordinary packages carrying one
 * member of every collection family, in the two shapes — today's additive one
 * and the ruled option-B one (flattened collections stripped, `packages[]`
 * intact). `option-b-reader-probe.ts` runs every reader over each shape and
 * reports what each subsystem SAW. Both entry paths are driven, because they
 * share no seam: the compiled artifact is written to disk and loaded through
 * `loadArtifactBundle` / `createStandaloneStack` / `resolve-project-database`,
 * and the from-source config is driven exactly as `os serve` / `os dev` /
 * `os build` / `os migrate` drive it after their own `loadConfig`.
 *
 * ## Why the losses are LEDGERED instead of simply asserted away
 *
 * The card's acceptance is that the option-B leg is RED today — a probe already
 * green on option-B before any reader work has landed is a broken probe. A
 * permanently red test cannot land, so the red is held the way every other
 * measured-state gate in this repo holds one: `OPTION_B_LOSSES` records EXACTLY
 * which rows lose today, and the pin asserts set EQUALITY against it.
 *
 * That gives all four directions at once, and the last two are the ones a bare
 * `expect(...).toBe(0)` could not give:
 *
 *   - a reader fixed by card 2/4, 3/4 or 4/4 ⇒ RED, naming the ledger line to
 *     DELETE. The ledger shrinks one subsystem at a time, exactly as the ruling
 *     describes, and reaching empty is what "the program is done" means.
 *   - a reader that REGRESSES ⇒ RED, naming the row.
 *   - a NEW reader nobody enumerated, arriving in a later change ⇒ RED on
 *     arrival, which is the entire point of the card.
 *   - the probe itself quietly measuring less ⇒ RED, because a row that stops
 *     being measured stops matching its ledger line.
 *
 * ⛔ `OPTION_B_LOSSES` is SHRINK-ONLY. Adding a line is never how a red build is
 * fixed — teaching the reader to resolve `packages[]` is. A row that belongs in
 * this ledger is a subsystem that silently loses a collection, and the reader
 * program exists to remove it.
 *
 * ## Reverse-verified, per the card
 *
 * Run with `OPTION_B_LOSSES` emptied on `origin/main` `33681eaef`, the pin
 * reports **24 subsystems** losing their collections, across all three packages
 * the program scopes — the full red output is recorded in #15004's PR body.
 * In the SAME run the additive baseline and the `packages[]` control both pass,
 * which is what makes the red a discrimination rather than a broken fixture.
 *
 * Re-verified at the empty ledger, which is the state that could go vacuous:
 * with `@objectstack/runtime`'s `resolveArtifactCollections` neutered to the
 * identity function and that package REBUILT (the pin reaches it through its
 * `exports` map, so `dist/` is what it measures), this pin goes RED naming
 * exactly 23 rows — the same 23, byte for byte, that the ledger carried before
 * #15005. Restored and rebuilt, 7 passed. So the empty ledger is a measurement
 * of the readers, not of a probe that stopped looking.
 *
 * One row in that output is worth naming here, because it is a loss no
 * presence-check would have found: on the compiled path a function declared
 * `effect: 'writes'` comes back through `collectBundleFunctionEntries` as
 * `effect: 'pure'`. `mergeRuntimeModule` re-supplies the CALLABLE from the
 * sibling ESM module regardless of shape, and `normalizeFlowFunctionEntry`
 * defaults a bare callable's effect — so the collection is not absent, it is
 * WRONG, and the writer's writes are counted as none.
 *
 * ## Boundaries — what this pin does NOT reach, stated rather than implied
 *
 * ### Closed by #15006 (card 3/4)
 *
 * Four reads were named here as unreachable: `serve.ts`'s two `config.objects`
 * auto-registration gates on the FROM-SOURCE leg, `dev.ts`
 * `readArtifactObjects()`, and `compile.ts`'s union authoring-rule run. They
 * were unreachable not because of the artifact but because each was an
 * EXPRESSION inside an oclif command body — no exported reader, nothing a probe
 * could call. Card 3/4 introduced the seam
 * (`packages/cli/src/utils/stack-collections.ts`), so the probe now carries a
 * row per site and each one CALLS the decision the command makes. The
 * prohibition that stood beside them still stands and is repeated where those
 * rows live: ⛔ a row that asserts `config.objects` on an option-B config is a
 * second copy of the read it watches, stays red after that read is fixed, and
 * then gets deleted.
 *
 * ⚠️ The two `serve.ts` gates were only HALF covered before, and the half that
 * was covered is the ARTIFACT leg — `createStandaloneStack` surfaces `objects`
 * precisely so that path can drive them, and that row is in the ledger. That
 * row stays: `standalone-stack.ts` omits the key entirely when the array is
 * absent, and no CLI-side seam can resolve what the runtime never surfaced. It
 * is card 2/4's (#15005) to delete, not this file's.
 *
 * ### Still open
 *
 * `plugins` and `devPlugins` are package-owned collections by the same
 * derivation every row here uses, and `serve.ts` / `schema-migration-plugins.ts`
 * read them off the top level only. The zoo declares none, so no row measures
 * them, and the fix is NOT mechanical: a JSON artifact's `packages[i].plugins`
 * would be inert data where the call site expects a live plugin instance, and
 * whether a live-object collection belongs in the package-owned key set at all is
 * a `packages/spec` question upstream of every reader here. Filed as #15219
 * rather than folded in.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  additiveProject,
  optionBProject,
  ARTIFACT_ENVELOPE_KEYS,
  PACKAGE_OWNED_COLLECTION_KEYS,
} from './fixtures/option-b-collection-zoo.js';
import { measureShape, type ProbeRow, type ShapeMeasurement } from './fixtures/option-b-reader-probe.js';

/**
 * The subsystems that silently lose their collection when the flattened top
 * level is gone — MEASURED, not curated. ⭐ EMPTY: the reader half of the
 * option-B program is done, and the emitter half (#14512) is unblocked.
 *
 * How it got here, in the order the rows actually went:
 *
 *   - opened at **24 rows** on `origin/main` `33681eaef` (#15004);
 *   - **23 → 23** when #15007 (`@objectstack/plugin-security`) landed, deleting
 *     `B2 · plugin-security appSecurityPluginOptions over the from-source
 *     config`, the one row no artifact-side change could reach;
 *   - **23 → 0** here (#15005), when `@objectstack/runtime` learned to resolve
 *     `packages[]`: the whole of boundaries B1 and B5, and every B2 row whose
 *     reader ships in that package.
 *
 * ⚠️ The last row to go was a plugin-security one and it is NOT #15007's twin
 * arriving late: `B1 · plugin-security appSecurityPluginOptions over the
 * artifact-serve config` runs that same reader over `createStandaloneStack`'s
 * RESULT. Nothing inside `@objectstack/plugin-security` could move it — the
 * standalone result carried neither the permission sets nor a route to them —
 * and it goes green because that result now surfaces `permissions` resolved
 * across both shapes, which plugin-security's existing top-level branch then
 * answers. One reader, two boundaries, each owned by a different card: that
 * split is what the header's B1/B2 distinction is for.
 *
 * ⛔ SHRINK-ONLY, audited in BOTH directions (see the header). An empty ledger
 * is the STRONGEST state this pin has, not a disabled one: every row the probe
 * measures must now be `present` in BOTH shapes, so a reader that regresses —
 * or a new reader that arrives unresolved — is red on arrival with nothing left
 * to absorb it. Adding a line is never how that red is fixed.
 */
const OPTION_B_LOSSES: readonly string[] = [];

const render = (rows: ProbeRow[], only?: (r: ProbeRow) => boolean): string =>
  rows
    .filter((r) => (only ? only(r) : true))
    .map((r) => `  ${r.lost ? 'LOST   ' : 'present'}  ${r.id} = ${r.observed}`)
    .join('\n');

describe('#15004 — option-B acceptance pin: every subsystem must see its collections in BOTH shapes', () => {
  let roots: string[] = [];
  let additive: ShapeMeasurement;
  let optionB: ShapeMeasurement;

  beforeAll(async () => {
    const mkRoot = (tag: string): string => {
      const dir = mkdtempSync(join(tmpdir(), `os-option-b-${tag}-`));
      roots.push(dir);
      return dir;
    };
    additive = await measureShape(additiveProject(), mkRoot('additive'));
    optionB = await measureShape(optionBProject(), mkRoot('optionb'));
  }, 120_000);

  afterAll(() => {
    for (const dir of roots) rmSync(dir, { recursive: true, force: true });
    roots = [];
  });

  // ── The two shapes are what they claim to be ─────────────────────────────

  it('the two shapes differ in exactly the package-owned collections, derived from the schemas', () => {
    const additiveKeys = Object.keys(additiveProject() as Record<string, unknown>).sort();
    const optionBKeys = Object.keys(optionBProject() as Record<string, unknown>).sort();

    // A positive first, so the set difference below is a measurement rather
    // than two empties agreeing.
    expect(PACKAGE_OWNED_COLLECTION_KEYS.length).toBeGreaterThan(30);
    expect(ARTIFACT_ENVELOPE_KEYS).toEqual(
      ['api', 'devPlugins', 'i18n', 'manifest', 'onEnable', 'packages', 'plugins', 'runtimeModule', 'server'],
    );

    // Every key option B drops is a package-owned collection, and every key it
    // keeps is an envelope key. Nothing else moved.
    const dropped = additiveKeys.filter((k) => !optionBKeys.includes(k));
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.filter((k) => !PACKAGE_OWNED_COLLECTION_KEYS.includes(k))).toEqual([]);
    expect(optionBKeys.filter((k) => !ARTIFACT_ENVELOPE_KEYS.includes(k))).toEqual([]);
  });

  it("CONTROL — the reader that already resolves `packages[]` sees the SAME items in both shapes", () => {
    // `MetadataPlugin` / `ObjectQLPlugin` register through
    // `resolveArtifactPackageOrder`, so the SchemaRegistry is served by
    // `packages[]` and must not notice the difference. This is the anti-vacuity
    // control for every LOST row below: it proves the option-B fixture really
    // carries every definition under `packages[]`, so a zero is a reader losing
    // a collection and never a fixture that shipped an empty package.
    expect(additive.registryObjectsFromArtifact).toEqual(['probe_account', 'probe_order']);
    expect(optionB.registryObjectsFromArtifact).toEqual(additive.registryObjectsFromArtifact);
    expect(optionB.registryObjectsFromSource).toEqual(additive.registryObjectsFromSource);
    expect(optionB.registryObjectsFromSource).toEqual(['probe_account', 'probe_order']);
  });

  // ── The baseline: green today, and it must stay green ────────────────────

  it('BASELINE — on today\'s additive shape every subsystem sees its collections', () => {
    const lost = additive.rows.filter((r) => r.lost);
    expect(
      lost.map((r) => r.id),
      `The pin's BASELINE broke: ${lost.length} subsystem(s) see nothing on the shape the ` +
        `platform emits TODAY. This is never an option-B finding — it means the fixture stopped ` +
        `carrying a collection, or a reader regressed on the additive path.\n${render(additive.rows)}`,
    ).toEqual([]);
    // Anti-vacuity: the assertion above is satisfied by an EMPTY row set, so a
    // probe that quietly stopped measuring has to be caught right here.
    //
    // ⚠️ RE-ANCHORED when the ledger reached zero. The floor used to be
    // `OPTION_B_LOSSES.length`, which was a real bound only while the ledger
    // was non-empty; at zero it reads `rows.length >= 0` — true of every
    // array, including an empty one. It was dead code wearing a control's
    // comment, and the fourth direction this file's header claims ("the probe
    // itself quietly measuring less ⇒ RED") had silently stopped existing.
    //
    // 30 is MEASURED, not remembered: with this line temporarily written
    // `expect(additive.rows.length).toBe(-1)`, the run reports
    // `expected 30 to be -1`. Verified live at the boundary in the same
    // session — a floor of 31 goes RED on the same fixture, so the assertion
    // is not satisfied by construction.
    //
    // `>=` rather than `toBe` on purpose, and it is the same shrink-only
    // direction the ledger uses: a row ADDED to the probe is welcome and stays
    // green, a row that stops being measured is red. Raise the floor when the
    // probe grows; ⛔ never lower it to make a red run green.
    expect(
      additive.rows.length,
      `The probe measured ${additive.rows.length} rows, fewer than the 30 it measured when ` +
        `this floor was set. A row that stops being measured stops being able to fail, which ` +
        `is the one direction this pin cannot detect anywhere else — fix the probe rather ` +
        `than the floor.`,
    ).toBeGreaterThanOrEqual(30);
  });

  // ── The pin ──────────────────────────────────────────────────────────────

  it('THE PIN — the subsystems that lose their collections under option B are EXACTLY the ledgered ones', () => {
    const measured = optionB.rows.filter((r) => r.lost).map((r) => r.id).sort();
    const ledger = [...OPTION_B_LOSSES].sort();

    const newlyLost = measured.filter((id) => !ledger.includes(id));
    const nowFixed = ledger.filter((id) => !measured.includes(id));

    expect(
      measured,
      newlyLost.length > 0
        ? `A subsystem lost a collection that the ledger does not carry — this is the failure ` +
          `#15004 exists to make loud. An option-B artifact reaches it with the collection ABSENT ` +
          `and NOTHING THROWN.\n\n  ${newlyLost.join('\n  ')}\n\n` +
          `⛔ Do not add these to OPTION_B_LOSSES. Teach the reader to resolve \`packages[]\` ` +
          `(cards #15005 runtime / #15006 cli / #15007 plugin-security), or file the site as 5/4 ` +
          `if it is a package the program never scoped.\n\nFull option-B report:\n${render(optionB.rows)}`
        : `A ledgered subsystem now SEES its collections under option B — the reader program moved ` +
          `forward. Delete these lines from OPTION_B_LOSSES:\n\n  ${nowFixed.join('\n  ')}\n\n` +
          `When the ledger is empty the reader half is done and the emitter half (#14512) can land.`,
    ).toEqual(ledger);
  });

  it('the ledger names only rows the probe actually measures', () => {
    // A phantom ledger line would silently license a subsystem nobody watches.
    const ids = new Set(optionB.rows.map((r) => r.id));
    expect(OPTION_B_LOSSES.filter((id) => !ids.has(id))).toEqual([]);
  });

  it('every one of the five boundaries is represented in the probe', () => {
    // The enumeration's own finding is that a probe covering one boundary
    // proves nothing about the others — B5 in particular runs 112 lines BEFORE
    // `loadArtifactBundle` inside `createStandaloneStack` and is reached
    // independently from `os dev`, `os start` and `os db clean`.
    const ids = optionB.rows.map((r) => r.id);
    for (const boundary of ['B1 · ', 'B2 · ', 'B5 · ']) {
      expect(ids.filter((id) => id.startsWith(boundary)).length, `${boundary} has no row`)
        .toBeGreaterThan(0);
    }
    // B3 (`os build`) and B4 (`os migrate`) load the config module through the
    // same loader B2 does and hand the export on untouched, so their readers
    // are the B2 rows. The header's "Boundaries" section states what that does
    // and does not cover.
    expect(ids.some((id) => id.startsWith('B5 · resolve-project-database'))).toBe(true);
  });

  it('#15006 — the four cli reads that had no callable seam are each represented', () => {
    // These four were named in this file's header as OUT of reach. They are in
    // reach now, and this test is what stops them from quietly leaving again:
    // the pin asserts set EQUALITY against the ledger, so a row that stopped
    // being measured while it was GREEN would take nothing red with it.
    const ids = optionB.rows.map((r) => r.id);
    for (const site of [
      'B2 · cli serve ObjectQL engine auto-registration gate (from source) · objects',
      'B2 · cli serve storage-driver auto-registration gate (from source) · objects',
      'B1 · cli dev artifact object inventory (readArtifactObjects recompile diff) · objects',
      'B3 · cli build union author-time rule input (os build) · every package-owned collection',
    ]) {
      expect(ids, `#15006 site no longer measured: ${site}`).toContain(site);
    }
  });
});
