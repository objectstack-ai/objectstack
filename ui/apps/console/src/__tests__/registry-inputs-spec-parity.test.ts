/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Registry `inputs` <-> `@objectstack/spec` `ComponentPropsMap` parity, for
 * EVERY block that has both, in BOTH directions (objectui#3797, objectui#3808).
 *
 * PR #3795 landed both directions on one block (`record:highlights`, see
 * `packages/plugin-detail/src/__tests__/recordHighlightsInputs.spec-parity.test.ts`).
 * This file is the repo-wide half, and it carries the same two:
 *
 *   FORWARD (objectui#3797, PR #3806) — a block may not DECLARE a top-level
 *   input its spec props schema does not accept.
 *
 *   REVERSE (objectui#3808) — a top-level key the spec DOES declare must be
 *   discoverable from that block's `inputs`.
 *
 * Both live in one file on purpose. #3808 exists because PR #3806 shipped only
 * the forward half repo-wide and the reverse half stayed on the single block
 * PR #3795 had covered; keeping them side by side, over one `covered` set and
 * one exemption discipline, is what stops a direction from being forgotten
 * again.
 *
 * WHY THE FORWARD DIRECTION MATTERS. `inputs` is not documentation, it is the
 * published authoring surface, and four layers are silent about a key that only
 * exists there:
 *
 *   1. `packages/sdui-parser/scripts/gen-manifest.ts` serializes `inputs` into
 *      `sdui.manifest.json` (the save-gate + parser whitelist) and into
 *      `sdui-intrinsics.d.ts` (the JSX authoring type surface), so both declare
 *      the key legal;
 *   2. `packages/sdui-parser/src/validate.ts` walks a node's top-level props
 *      against `comp.inputs`, finds the key there, and raises nothing;
 *   3. the spec's props schemas are plain (strip-mode) `z.object`s, so
 *      `parse()` drops an undeclared top-level key with no error;
 *   4. the renderer never sees it.
 *
 * Net: the platform's own manifest tells an author — very often an AI author —
 * to write a key the platform throws away, and nothing anywhere reports it.
 * That is objectstack#5435 ("platform authority must not point at keys its own
 * gate rejects") in reverse, and the second dialect AGENTS.md #0.1 exists to
 * prevent.
 *
 * It is not hypothetical on the objectstack side either. Since objectstack#5068,
 * `packages/lint/src/validate-component-props.ts` dispatches on the component
 * `type` and reports undeclared `properties.*` keys on `os validate` /
 * `os build` / `os lint`. So for the exempted keys below, the two platform
 * authorities disagree out loud about the same key today: objectui's manifest
 * offers it, the upstream linter warns on it, and the renderer honours it. Three
 * answers, and they cannot all be right — which is why an exemption here is
 * always paired with an issue that resolves the disagreement, never left as a
 * standing licence.
 *
 * WHY THE REVERSE DIRECTION MATTERS JUST AS MUCH. A key the spec declares, the
 * renderer honours, and `inputs` omits does not exist as far as an author can
 * tell — and the same four layers are just as quiet, only inverted:
 * `gen-manifest.ts` leaves it out of `sdui.manifest.json` and
 * `sdui-intrinsics.d.ts`, so it is in no designer panel and no `.d.ts`;
 * `sdui-parser`'s `validateTree` finds no input of that name in `comp.inputs`
 * and reports `unknown-prop` on it; and the renderer honours it anyway. An author who writes it is warned
 * off a key that works, and an author who doesn't never learns it is there.
 * That is objectui#3407's original complaint verbatim (`readonly` was enforced
 * by the HeaderHighlight gate and honoured by the renderer — the description
 * just never mentioned it), and objectui#3808 found it on three more keys plus
 * one this gate now covers as an exemption.
 *
 * The reverse direction bites non-public blocks too, which is the other reason
 * coverage is not limited to `PUBLIC_BLOCKS`: `element:text_input` never reaches
 * `sdui.manifest.json`, but `page.tsx`'s `getJsxManifest()` builds the JSX-page
 * compiler's prop whitelist from `getKnownTypes()` + these same `inputs`, so its undeclared
 * `defaultValue` was a live `unknown-prop` warning on a key the renderer seeded
 * page variables from.
 *
 * WHY IT LIVES HERE. The check needs the FULL registration graph — the same one
 * that produces the published artifacts. `dev/manifest-dump.tsx` builds them
 * from `src/register-plugins.ts` plus `@object-ui/components`, so this file
 * imports exactly that pair (as `public-contract.test.ts` next door already
 * does) rather than a hand-assembled list that could agree with itself and
 * prove nothing. Coverage is deliberately NOT limited to the public tier:
 * `getJsxManifest()` in `packages/components/src/renderers/layout/page.tsx`
 * builds the runtime JSX-page validation manifest from `getKnownTypes()`, so a non-public block's
 * `inputs` are a live prop whitelist too — that is how `element:record_picker`,
 * absent from `PUBLIC_BLOCKS`, still publishes an authoring surface.
 *
 * EXPECTATIONS ARE DERIVED, NOT RESTATED. The accepted key set comes from
 * `ComponentPropsMap[type]`'s own shape at runtime. A spec release that adds or
 * removes a key therefore moves this gate with it instead of quietly widening
 * the gap — which is also how the stale-pin exemptions below are meant to
 * resolve themselves.
 *
 * EXEMPTIONS ARE EXPLICIT, EACH CARRIES A REASON, AND A STALE ONE FAILS. A new
 * divergence has to be registered in a diff someone reviews; it can never
 * arrive silently. And once the spec declares an exempted key, the entry must be
 * DELETED rather than kept — the last test in this file turns a no-longer-needed
 * exemption red, so the list cannot rot into a permanent allowlist.
 *
 * LIMIT — worth knowing before trusting a pass. Of the two things this gate
 * used to be unable to see, ONE IS NOW GATED and one is still deliberately not:
 *
 *   - member KINDS — CLOSED, objectui#8067. This gate used to compare top-level
 *     key names and nothing else, because an `inputs` entry of type
 *     `array`/`object` declared no member shape at all: `ComponentInput` had no
 *     slot for one, so a member that drifted from the contract was invisible
 *     here. That is what `page:header.actions` cost — spec `z.array(z.string())`
 *     ("Action IDs"), a renderer reading the members as `ActionDef` OBJECTS, and
 *     this gate green for the whole life of the drift because both sides had the
 *     key. `ComponentInput.of` now carries the member kind, and the MEMBER
 *     DIRECTION section below compares every declared one against what
 *     `ComponentPropsMap[type]` accepts at the member position. It stops at the
 *     KIND, exactly as the arm direction does: `of: 'object'` says the members
 *     are objects, never WHICH KEYS they have. Those keys — `record:details
 *     .sections`, `record:highlights.fields` and `record:related_list.add`
 *     among them — publish their members in prose and are pinned by per-block
 *     tests next to their renderers, and since objectui#8068 the MEMBER-PIN
 *     DIRECTION below makes naming that pin MANDATORY rather than voluntary.
 *     PR #3795's open question, half of it closed;
 *   - types, NARROWER than the contract. A key can be in perfect name parity
 *     while declaring fewer arms than the spec accepts, and this gate does not
 *     look. That half is deliberately left to per-block discipline, for the
 *     reason the ARM DIRECTION section below sets out: narrowing is NOISY, and
 *     noise is at least audible. It applies to `of` unchanged — a member union
 *     declared with one arm is not gated either, and the keys left undeclared
 *     for that reason are pinned in `MULTI_KIND_MEMBER_CONTRACTS`.
 *
 * A pass means the top-level key names are in parity, that no declared arm is
 * one the contract refuses outright, and that no declared MEMBER kind is —
 * nothing more.
 *
 * ── THE ARM DIRECTION, AND WHY ONLY ONE OF ITS TWO HALVES IS GATED ──────────
 *                                                             (objectui#4971)
 *
 * `ComponentInput.type` used to carry ONE coarse kind. objectui#3832 gave it
 * the ARRAY form so a key whose contract is a union can declare its real arms —
 * and in doing so created a SECOND way for a declaration to disagree with the
 * contract. The two are not symmetric, and the asymmetry is the whole argument
 * for gating one and not the other:
 *
 *   - NARROWING — declaring FEWER arms than the spec accepts — produces NOISE.
 *     `sdui-parser`'s `checkType` reports `type-mismatch` on a value the
 *     contract is perfectly happy with; the author is warned off a legal write.
 *     Annoying, occasionally harmful (noise on legal writes trains authors, AI
 *     authors included, to dismiss the reports that ARE real) — but AUDIBLE.
 *     Somebody sees it.
 *   - WIDENING — declaring an arm the spec REJECTS — is SILENT. `checkType`
 *     clears a value the contract refuses, the manifest and the generated
 *     `.d.ts` publish it as legal, and `os validate` / `os build` are the first
 *     thing in the chain to say no, long after the metadata was written.
 *     `declared = enforced` inverts, and NOTHING announces it.
 *
 * Before #3832 only the narrow mode existed, so the gap self-announced. After
 * it, the silent mode is live and needs a gate. That is this one, and it is
 * ONE-DIRECTIONAL on purpose: every declared arm must be a shape the contract
 * accepts (a SUBSET of what the spec takes on that key). It does not ask the
 * reverse question.
 *
 * MEASURED, and this is what "done" meant for #4971. Two fake arms were added
 * on the #3832 branch, one per specimen. `element:text_input.defaultValue` grew
 * an `'object'` arm the spec rejects and the per-block
 * `text-input-inputs-spec-parity.test.ts` pinned it red. `page:card.title` grew
 * a `'number'` arm the spec rejects and the WHOLE SUITE stayed green — 856
 * tests, not one gate noticing. The only difference between the two is that
 * `element:text_input` happens to have a per-block test and `page:card` does
 * not: the property held by DISCIPLINE, block by block, not by a gate.
 *
 * ## What an arm is compared against — the COARSE-KIND ceiling
 *
 * An arm names a value's KIND, never its DOMAIN (`ComponentInput.type`, and the
 * maintainer ruling of 2026-08-17 quoted there: "the coarse arm plus
 * `description` IS the publication face's expression ceiling today, and SPEC IS
 * THE SOLE JUDGE OF VALUES"). `page:header.maxVisible` is the worked example —
 * its contract is a POSITIVE SAFE INTEGER, its arm is `'number'`, and `0` /
 * `-1` / `1.5` pass this layer by design.
 *
 * So the question this gate asks is the one the ruling leaves it: does the
 * contract accept ANY value of that kind on that key? A `'number'` arm on a key
 * whose contract is `1..n` is in scope of the ruling and stays green. A
 * `'number'` arm on a key whose contract is a STRING accepts nothing the
 * contract accepts, and is what `declared = enforced` cannot survive.
 *
 * ## Kind-refusal vs value-refusal — the trap this gate is built around
 *
 * The naive probe ("does `safeParse` accept a representative value of this
 * kind?") is WRONG in two measured ways, and both make a CORRECT arm read as
 * invented — the false red triage flagged when this card was scoped:
 *
 *   1. ENUM CONTRACTS. `record:quick_actions.variant` is a spec enum, declared
 *      with a `'string'` arm. A representative string is refused — as a VALUE,
 *      not as a kind. Reading that as "the string arm is fake" would condemn a
 *      declaration the ruling above expressly permits.
 *   2. REQUIRED SIBLINGS. `{ filter: … }` alone fails `element:number`'s schema
 *      for the missing `object` / `aggregate`, and would report every arm of
 *      every key on such a block as fake.
 *
 * `specArmVerdict` therefore reads the ISSUES rather than the boolean: it looks
 * only at issues about THIS key (so siblings cannot speak for it), and it
 * refutes an arm only when the refusal is at the key's own node AND is a KIND
 * refusal (`invalid_type`, or an `invalid_union` whose every branch refuses the
 * kind). A refusal deeper in the value, or of any other code, means the kind got
 * in and the CONTENT was judged — which is precisely the ceiling above, so the
 * arm stands.
 *
 * That is the exemption for enum CONTRACTS, and it is a rule rather than a list.
 * The one thing it must not do is let #4971's own measurement through, so the
 * calibration is asserted by name: `page:card.title` + `42` must read
 * `refuses-kind` (the fake arm reds), while `record:quick_actions.variant` +
 * `'Account'` must read `refuses-content` (the enum arm does not).
 *
 * An `enum` ARM is judged differently and exactly, because it is the one arm
 * whose admitted set is FINITE and written down: `armAccepts` consults the
 * input's own `enum` list, so every declared member must be a value the spec
 * accepts. No coarseness is needed and none is taken.
 *
 * Two arm kinds are EXEMPT, listed rather than silent: `'slot'` (it describes a
 * CHILD POSITION, not a value — `armAccepts` admits everything for it, so there
 * is no value-shaped claim to compare), and an `'enum'` arm that declares NO
 * members (it admits nothing, so it can widen nothing).
 *
 * `retiredKey()` TOMBSTONES USED TO BE THE THIRD — CLOSED, objectui#3809.
 * ADR-0087 D2 retirement replaces a member with `z.never().optional()` instead
 * of deleting it, so raw `Object.keys(shape)` reported a key the spec rejects BY
 * NAME as though the contract accepted it. Both directions read that one set,
 * and they failed OPPOSITE ways on it: forward went falsely GREEN on a block
 * publishing a retired key, reverse went falsely RED demanding that a block
 * publish one. `specTopLevelKeys` now subtracts tombstones, which is the single
 * point that fixes both, and the derivation's own premise — that a retirement
 * KEEPS the member — is asserted rather than assumed (`the tombstone premise
 * still holds`), so the day upstream starts deleting keys outright this filter
 * is judged dead code instead of silently narrowing nothing.
 *
 * The blind spot was NOT dormant by the time it was fixed, which is worth
 * recording because the issue was filed believing it was. It was written against
 * `@objectstack/spec@17.0.0-rc.5`, where `ComponentPropsMap` carried no
 * tombstone at all; the rc.6 pin (objectui#4167) brought EIGHT, the 17.0.0 GA
 * pin (objectui#4636 / PR objectui#4639) carries the same eight, and the reverse
 * direction's red was live from rc.6 onward — absorbed, key by key, by the eight
 * `UNPUBLISHED_EXEMPTIONS` entries that named this issue as the only thing that
 * could resolve them. Those eight are deleted with this change; the pin below
 * (`the eight tombstoned keys are recognised, not exempted`) is what keeps their
 * deletion from being quietly undone by re-exempting a key instead.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import {
  ComponentPropsMap,
  PageComponentSchema,
  PageComponentType,
  RETIRED_PAGE_COMPONENT_TYPES,
} from '@objectstack/spec/ui';
import { MANIFEST_INPUT_TYPES, inputTypeArms } from '@object-ui/sdui-parser';
import type { ComponentInput } from '@object-ui/types';
import {
  authorableShapeKeys,
  isShapeKeyTombstoned,
  listedShapeKeys,
  tombstonedShapeKeys,
} from '@object-ui/test-support';

// The graphs whose registrations this file reads, at module scope rather than
// in a hook: their cold transform is billed to the import phase, which has no
// test/hook timeout (AGENTS.md §测试纪律, objectui#3010).
import '@object-ui/components';
import '../register-plugins';

// ── objectui#8176: the blocks `register-plugins` alone cannot show this gate ──
//
// `register-plugins` is the console's REAL block layer, and importing it is what
// makes this gate read the registrations the console ships rather than a
// hand-copied list. It is not sufficient on its own, and the gap was silent for
// as long as this file existed.
//
// Most of that module's plugin blocks are registered with
// `ComponentRegistry.registerLazy`, which files a STUB carrying only the meta
// `registerLazy` was handed — no `inputs`, until the chunk loads. `getConfig`,
// which `declaredInputEntries` below calls, is loaded-only BY DESIGN (its own
// docblock: it answers "can I render this right now", and callers read
// `.component` off the result). So for a lazily-registered block `getConfig`
// returned `undefined`, `declaredInputs` returned `null`, and the block landed
// in neither `covered` (filter: `length > 0`) nor `registeredWithoutInputs`
// (filter: `length === 0`, which `null` does not satisfy). Unjudged AND
// uncounted — the gate reported green over a population it never read.
//
// MEASURED on `origin/main` `0c8dbc492` before this import existed: 42 blocks in
// `ComponentPropsMap`, 27 judged, 7 counted as propless, and 8 in neither set.
// Two of those 8 — `object-calendar` and `object-kanban` — are spec-carried
// blocks this repo registers WITH inputs, hidden only by the lazy stub. That is
// the structural reason objectui#7712 (a spec-declared `filter` published by
// neither registration) was invisible to this direction.
//
// Loading the two plugin packages here is the fix, and the import is the whole
// of it: their top-level `ComponentRegistry.register()` calls replace the stubs
// with real registrations, `getConfig` answers, and both blocks enter `covered`.
// The cost is import-phase transform, which is the right place for it (the same
// note as above). `no spec-carried block is registered but unloaded` below is
// what keeps this list correct: a future plugin block that reaches
// `ComponentPropsMap` while the console registers it lazily fails there, by
// name, instead of quietly rejoining the blind spot.
import '@object-ui/plugin-kanban';
import '@object-ui/plugin-calendar';
// objectui#11168 slice 3 — the same remedy for the lazily registered blocks
// `@objectstack/spec` 17.5.0 newly carries, one block at a time: each import
// below is what takes a block out of `UNJUDGED_SPEC_BLOCKS` (where the bump
// booked it OWED) and puts it under both directions. `MINOR_17_5_LOADED_BLOCKS`
// names them. Slice 4 adds `@object-ui/plugin-gantt`, and slice 5
// `@object-ui/plugin-timeline`, the last of the four.
import '@object-ui/plugin-tree';
import '@object-ui/plugin-map';
import '@object-ui/plugin-gantt';
import '@object-ui/plugin-timeline';

/** This block's spec props schema, or `undefined` when this pin has none. */
const specSchema = (type: string): unknown => (ComponentPropsMap as Record<string, unknown>)[type];

/**
 * Top-level keys `ComponentPropsMap[type]` ACCEPTS — tombstones excluded
 * (objectui#3809).
 *
 * This one function is where both directions of this file get their notion of
 * "the contract's authoring surface", which is why narrowing it here fixes two
 * opposite defects at once. It used to be raw `Object.keys(shape)`, and an
 * ADR-0087 D2 retirement does not delete the key — it replaces the member with
 * `z.never().optional()` — so a key the spec rejects BY NAME kept answering
 * "declared". Forward that reads as GREEN on a block publishing a retired key;
 * reverse it reads as RED demanding a block publish one. Same set, opposite
 * failures.
 *
 * The judgement itself lives in `@object-ui/test-support` rather than here: it
 * had been hand-written four times across this repo's gates, the copies had
 * already drifted (two structural-only, one absent — this file), and the shared
 * one is calibrated once against what the contract's own `safeParse` rejects
 * (`spec-tombstones.test.ts`). Zod-internals access now happens in exactly one
 * module repo-wide.
 */
function specTopLevelKeys(type: string): string[] {
  return authorableShapeKeys(specSchema(type));
}

/**
 * Every top-level key the schema still LISTS — tombstones INCLUDED.
 *
 * Deliberately kept alongside the narrowed set, because two questions in this
 * file are about the RELEASE rather than about the authoring surface, and a
 * retired key must answer YES to them: "did this pin ever carry the key at all"
 * (`isDormantOnThisPin`) and "is the tombstone premise still true"
 * (`the tombstone premise still holds` below). Using the narrowed set for
 * either would be the same conflation in a new place — a retired key would read
 * as a key the pin never had.
 */
const specListedKeys = (type: string): string[] => listedShapeKeys(specSchema(type));

/** The listed top-level keys this block's spec schema rejects by name. */
const specTombstonedKeys = (type: string): string[] => tombstonedShapeKeys(specSchema(type));

/**
 * Declared input ENTRIES for a registered block, or `null` when not registered.
 *
 * The arm direction (objectui#4971) needs more of an input than its name — the
 * declared `type` arms, and an `enum` arm's own member list — so the registry
 * read happens once, here, and `declaredInputs` projects it. Two readers of
 * `config.inputs` would be two chances to disagree about which registration a
 * verdict came from.
 */
function declaredInputEntries(type: string): ComponentInput[] | null {
  const config = ComponentRegistry.getConfig(type);
  if (!config) return null;
  return (config.inputs ?? []) as ComponentInput[];
}

/** Declared input names for a registered block, or `null` when not registered. */
function declaredInputs(type: string): string[] | null {
  return declaredInputEntries(type)?.map((input) => input.name) ?? null;
}

/**
 * Keys the spec accepts on the NODE itself, on every page component
 * (objectui#6678).
 *
 * `ComponentPropsMap[type]` is the per-block PROPS half of a component's
 * contract. It is not the whole contract: `PageComponentSchema` — the schema of
 * the node these `inputs` describe — carries its own top-level keys, and the
 * html tier validates an author's attributes against `BASE_PROPS` ∪ `inputs`,
 * with no third place for a node-level key to be declared.
 *
 * That distinction was invisible while no block declared a node-level key, and
 * it stopped being invisible with `dataSource`: the spec's per-element data
 * binding, read by every block that wraps `ElementDataSourceGate`, declared by
 * none, and therefore reported by the html tier as a prop that does not exist —
 * the one spelling that resolves a saved view, reported exactly like the
 * spellings that do nothing (objectui#6678). The maintainer ruling of
 * 2026-08-29 declares it on the blocks that read it, emitted at the wrapping
 * seam; `BASE_PROPS` (which mirrors `BaseSchema`) was refused, because it would
 * also silence the key on `flex` and `card`, which do not read it.
 *
 * So the forward direction's question — "does the contract accept this key on
 * this node?" — has to be asked of the whole node contract. It is DERIVED here,
 * not listed: `PageComponentSchema` is the object whose shape names those keys.
 * (Through `@objectstack/spec` 18.0.0-next.2 it was a `.pipe()` that folded the
 * retired `visibility` spelling into `visibleWhen`, and the keys sat on its
 * input side; 18.0.0-next.3 drops that fold, objectstack `105902f`.) A spec
 * release that adds or removes one moves this set with it.
 *
 * ⚠️ Used by the FORWARD direction only. Feeding it to the reverse direction
 * would demand that every covered block publish `dataSource` — including the
 * blocks that do not read it, which is the exact lie the ruling refused.
 */
const nodeLevelSpecKeys = (): string[] => authorableShapeKeys(PageComponentSchema);

/** Top-level inputs this block declares that its spec props schema rejects. */
function offSpecInputs(type: string): string[] {
  const allowed = new Set([...specTopLevelKeys(type), ...nodeLevelSpecKeys()]);
  return (declaredInputs(type) ?? []).filter((name) => !allowed.has(name));
}

/**
 * Spec keys that no block is expected to publish, with the reason — applied to
 * every block rather than repeated as one exemption entry per block.
 *
 * Only `aria` qualifies, and only because the reason is genuinely uniform: it is
 * an accessibility escape hatch, not a layout choice, and the blocks that omit
 * it say so in the same words at their registration sites
 * (`plugin-detail/src/index.tsx`, the comment above the `record:activity`
 * registration, verbatim: "`aria` is omitted for the same reason it is omitted
 * on `record:details` above"). Publishing it would put
 * an `aria` object in every designer panel and every generated `.d.ts` as though
 * hand-writing ARIA were the normal way to configure a block, when the renderers
 * derive their accessible names from labels and object metadata. A key whose
 * reason is per-block belongs in `UNPUBLISHED_EXEMPTIONS` below, not here.
 */
const GLOBALLY_UNPUBLISHED_SPEC_KEYS: Record<string, string> = {
  aria: 'Accessibility escape hatch, not a layout choice — renderers derive accessible names from labels and object metadata, and every block omits it for this one reason (plugin-detail/src/index.tsx, the comment above the record:activity registration). objectui#3808.',
};

/**
 * Top-level keys this block's spec props schema declares that its `inputs` do
 * not publish — the reverse direction (objectui#3808).
 */
function undiscoverableSpecKeys(type: string): string[] {
  const declared = new Set(declaredInputs(type) ?? []);
  return specTopLevelKeys(type).filter(
    (key) => !declared.has(key) && !(key in GLOBALLY_UNPUBLISHED_SPEC_KEYS),
  );
}

/**
 * The blocks this gate judges: an entry of `ComponentPropsMap` that this repo
 * registers with at least one `inputs` entry. A block with no `inputs` has no
 * declaration to be wrong.
 *
 * ⚠️ This set is a PARTITION MEMBER, not a standalone reading, and objectui#8176
 * is why the distinction is written down. Every `ComponentPropsMap` entry must
 * land in exactly one of three places — here, in `registeredWithoutInputs`
 * below, or in `UNJUDGED_SPEC_BLOCKS` with a reason — and
 * `accounts for every spec-carried block` asserts it. Before that assertion the
 * three sets did not have to add up, so a block could be absent from all of
 * them: not judged, and not counted as unjudged either. Eight were.
 *
 * The comment this docblock replaces said a block "present only as a
 * `registerLazy` stub, which has none yet — has no declaration to be wrong."
 * That reading was the defect stated as if it were the design: a lazy stub's
 * emptiness says nothing about the registration behind it, and for
 * `object-calendar` / `object-kanban` there WAS a declaration, and it WAS wrong.
 */
const covered = Object.keys(ComponentPropsMap)
  .filter((type) => (declaredInputs(type) ?? []).length > 0)
  .sort();

/**
 * Registered `ComponentPropsMap` blocks whose `inputs` is empty.
 *
 * Pinned below so "the declaration surface disappeared" is as visible as "it
 * grew a dialect": inputs emptied by accident would otherwise just shrink
 * `covered`, and every per-block assertion would keep passing on less.
 */
const registeredWithoutInputs = Object.keys(ComponentPropsMap)
  .filter((type) => declaredInputs(type)?.length === 0)
  .sort();

/**
 * The four `object-*` blocks `@objectstack/spec` 17.0.0 GA adds to
 * `ComponentPropsMap` and the pinned `17.0.0-rc.6` does not carry at all
 * (objectui#4648, measured on a GA-installed tree).
 *
 * This repo has registered all four with `inputs` since long before the spec
 * described them — the `ComponentRegistry.register('object-form', …)` and
 * `('object-master-detail-form', …)` calls in `plugin-form/src/index.tsx`,
 * `('object-grid', …)` in `plugin-grid/src/index.tsx` and `('object-metric', …)`
 * in `plugin-dashboard/src/index.tsx` —
 * so what moves at the pin bump is the SPEC's side, not this repo's: they enter
 * `covered` the moment the installed spec carries them, and the reverse
 * direction then asks each of them for the keys it does not publish.
 */
const GA_ONLY_BLOCKS = [
  'object-form',
  'object-grid',
  'object-master-detail-form',
  'object-metric',
];

/**
 * The five `record:*` blocks `@objectstack/spec` 17.1.0 adds to
 * `ComponentPropsMap` and `17.0.0` does not carry at all (objectui#5328;
 * the map goes from 37 entries to 42, and these are the five).
 *
 * Exactly the same shape as `GA_ONLY_BLOCKS` above, and for the same reason:
 * this repo has registered all five with `inputs` for far longer than the spec
 * has described them — `plugin-detail/src/index.tsx` registers `alert`,
 * `history`, `reference_rail`, `quick_actions` and `discussion` (each a
 * `ComponentRegistry.register('NAME', …)` call under `namespace: 'record'`) — so what moved at the pin bump is the SPEC's
 * side, not this repo's. They enter `covered` the moment the installed spec
 * carries them, and the reverse direction then asks each for the keys it does
 * not publish. Only `record:reference_rail` had one: `entries`, exempted below.
 */
const MINOR_17_1_BLOCKS = [
  'record:alert',
  'record:discussion',
  'record:history',
  'record:quick_actions',
  'record:reference_rail',
];

/**
 * Does the installed `@objectstack/spec` carry the 17.1.0 record set?
 *
 * Same observable-fact reasoning as `specCarriesGaBlocks` below, including the
 * `every` rather than `some`: the five arrived in one release, so a
 * half-carried state is a broken premise rather than an in-between pin.
 */
const specCarries171Blocks = MINOR_17_1_BLOCKS.every((type) => type in ComponentPropsMap);

/**
 * Does the installed `@objectstack/spec` carry the GA element set?
 *
 * The spec ships no version constant, so the observable fact is used instead —
 * and it is the fact this file actually depends on. `every` rather than `some`
 * on purpose: the four arrived in one release, so a half-carried state is a
 * broken premise rather than a pin somewhere in between, and the assertion
 * below fails on it instead of silently expecting the wrong coverage set.
 */
const specCarriesGaBlocks = GA_ONLY_BLOCKS.every((type) => type in ComponentPropsMap);

/**
 * Blocks the spec has carried since before the GA line, all of them declared in
 * this repo. Exact rather than `toContain` for the reason
 * `public-contract.test.ts` gives: the dangerous direction is a SHRINKING
 * contract, which a containment assertion sails straight past.
 */
const PINNED_EXPECTED_COVERED = [
  'element:button',
  'element:number',
  'element:record_picker',
  'element:text',
  'element:text_input',
  'page:accordion',
  'page:card',
  'page:footer',
  'page:header',
  'page:section',
  'page:sidebar',
  'page:tabs',
  'record:activity',
  'record:chatter',
  'record:details',
  'record:highlights',
  'record:path',
  'record:related_list',
];

/**
 * Every block with a spec entry AND a declared authoring surface, in sorted
 * order.
 *
 * Pin-dependent, and that is not a loosening: the expectation stays EXACT on
 * either pin, and which of the two it is gets asserted on its own below rather
 * than inferred. The alternative — hard-coding the GA four — would fail on
 * current `main`, and hard-coding only the eighteen fails the day the pin moves;
 * both readings are correct facts about different installed contracts.
 */
/**
 * The two spec-carried blocks the console registers ONLY with `registerLazy`,
 * newly judged by objectui#8176.
 *
 * Pin-INDEPENDENT, unlike the two groups above: `@objectstack/spec` has carried
 * both since well before the GA line, and this repo has registered both with
 * `inputs` for just as long (`OBJECT_KANBAN_INPUTS` in
 * `plugin-kanban/src/index.tsx`, and `OBJECT_CALENDAR_INPUTS` in
 * `plugin-calendar/src/index.tsx`, which both its `object-calendar` and
 * `calendar` registrations spread). Nothing about either side moved.
 * What moved is this FILE — it now loads the two plugin packages (see the import
 * block at the top), so `getConfig` answers for them and the reverse direction
 * reaches them for the first time.
 *
 * Kept as its own group rather than folded into `PINNED_EXPECTED_COVERED` so the
 * transition stays legible: a reader asking "why did this gate's population
 * change without a pin bump" gets the answer from the name and this docblock,
 * not from `git log`.
 */
const LAZY_REGISTERED_BLOCKS = [
  'object-calendar',
  'object-kanban',
];

/**
 * The six blocks `@objectstack/spec` 17.5.0 newly carries that this file JUDGES
 * (objectui#11073): the map went from 45 entries to 55. The other four new
 * entries — `object-gantt`, `object-map`, `object-timeline`, `object-tree` — are
 * registered lazily, and the bump booked them in `UNJUDGED_SPEC_BLOCKS` to
 * objectui#11168 instead (see `OWED_TO` below). That card loads them one block
 * at a time (slice 3 the tree and the map, slice 4 the gantt, slice 5 the
 * timeline); each loaded block moves to `MINOR_17_5_LOADED_BLOCKS`.
 *
 * Same shape as `GA_ONLY_BLOCKS` / `MINOR_17_1_BLOCKS`: this repo registered all
 * six with `inputs` before the spec described them, so what moved at the bump
 * is the SPEC's side. They enter `covered` the moment the installed spec
 * carries them.
 */
const MINOR_17_5_BLOCKS = [
  'action:button',
  'action:group',
  'action:icon',
  'action:menu',
  'element:definition-list',
  'element:repeater',
];

/** Does the installed `@objectstack/spec` carry the 17.5.0 set? `every`, for the reason `specCarriesGaBlocks` gives. */
const specCarries175Blocks = MINOR_17_5_BLOCKS.every((type) => type in ComponentPropsMap);

/**
 * The lazily registered 17.5.0 blocks this file LOADS and judges — objectui#11168
 * slices 3 to 5, which took them out of `UNJUDGED_SPEC_BLOCKS` one block at a
 * time, all four.
 * Kept as its own group for the reason `LAZY_REGISTERED_BLOCKS` is: a reader
 * asking why the population moved without a pin bump gets the answer here. Each
 * entry is a block whose plugin package is imported at the top of this file.
 *
 * Pin-dependent like `MINOR_17_5_BLOCKS`: the spec carries these rows from
 * 17.5.0 on, and they are expected only when it does.
 */
const MINOR_17_5_LOADED_BLOCKS = ['object-gantt', 'object-map', 'object-timeline', 'object-tree'];

/** Does the installed `@objectstack/spec` carry the loaded 17.5.0 blocks? `every`, for the same reason. */
const specCarries175LoadedBlocks = MINOR_17_5_LOADED_BLOCKS.every((type) => type in ComponentPropsMap);

/**
 * The one block `@objectstack/spec` 17.6.0 newly carries (objectui#11438): the
 * map went from 55 entries to 56 when `record:line_items` gained its row
 * (objectstack `24c554da`, #21142 / #21244). `@object-ui/plugin-form`
 * registers it eagerly with `inputs`, so this file JUDGES it from that pin on.
 * Its differences were booked to objectui#11536 under objectui#11438 ruling A′
 * (see `OWED_TO` above), not declared in the bump; that card's landing declared
 * the ten keys and pinned the member shapes, and struck every entry.
 *
 * Same shape as `MINOR_17_5_BLOCKS`: this repo registered the block with
 * `inputs` before the spec described it, so what moved at the bump is the
 * SPEC's side. It enters `covered` the moment the installed spec carries it.
 */
const MINOR_17_6_BLOCKS = ['record:line_items'];

/** Does the spec this tree resolves carry the 17.6.0 set? `every`, for the reason `specCarriesGaBlocks` gives. */
const specCarries176Blocks = MINOR_17_6_BLOCKS.every((type) => type in ComponentPropsMap);

/**
 * The one block the objectstack `main` pin after 18.0.0-next.3 newly carries
 * (objectui#12971): the map went from 60 entries to 61 when `list-view` gained
 * its row (objectstack#22444, landed as `194a42d1f7`), the list view's own
 * schema. `@object-ui/plugin-list` registers it eagerly with `inputs`, so this
 * file JUDGES it from that pin on.
 *
 * Same shape as `MINOR_17_6_BLOCKS`: this repo registered the block with
 * `inputs` before the spec described it, so what moved at the bump is the
 * SPEC's side. It enters `covered` the moment the installed spec carries it.
 */
const MINOR_18_MAIN_BLOCKS = ['list-view'];

/** Does the spec this tree resolves carry the post-next.3 set? `every`, for the reason `specCarriesGaBlocks` gives. */
const specCarries18MainBlocks = MINOR_18_MAIN_BLOCKS.every((type) => type in ComponentPropsMap);

const EXPECTED_COVERED = [
  ...PINNED_EXPECTED_COVERED,
  ...LAZY_REGISTERED_BLOCKS,
  ...(specCarriesGaBlocks ? GA_ONLY_BLOCKS : []),
  ...(specCarries171Blocks ? MINOR_17_1_BLOCKS : []),
  ...(specCarries175Blocks ? MINOR_17_5_BLOCKS : []),
  ...(specCarries175LoadedBlocks ? MINOR_17_5_LOADED_BLOCKS : []),
  ...(specCarries176Blocks ? MINOR_17_6_BLOCKS : []),
  ...(specCarries18MainBlocks ? MINOR_18_MAIN_BLOCKS : []),
].sort();

/**
 * Registered, spec-carried, and deliberately propless. `nav:*` / `global:search`
 * genuinely take no props; `element:image` / `element:metadata_viewer` /
 * `element:divider` / `ai:suggestion` are registered without an `inputs` list.
 * Either way there is no declaration for this gate to judge — but a block moving
 * OUT of `EXPECTED_COVERED` into here is an authoring surface that vanished, so
 * the list is pinned rather than derived-and-ignored.
 *
 * `page:footer` / `page:section` / `page:sidebar` LEFT this list in objectui#4027
 * and are now in `EXPECTED_COVERED`. They were the "`EmptyProps` blocks that
 * genuinely take no props" this comment used to name — a reading the pinned
 * rc.5 still supports and the contract no longer does: objectstack#5775
 * (PR objectstack#6281) replaced their `EmptyProps` entries with the shared
 * `PageContainerProps`, whose one key is the `children` all three renderers have
 * always rendered. Their `children` inputs are flagged by the forward direction
 * below purely as a stale-pin artifact.
 */
const EXPECTED_WITHOUT_INPUTS = [
  'ai:suggestion',
  'element:divider',
  'element:image',
  'element:metadata_viewer',
  'global:search',
  'nav:breadcrumb',
  'nav:menu',
];

/**
 * Has `@objectstack/spec` RETIRED this block, keeping its `ComponentPropsMap`
 * row only as a refusal door? (objectui#10033)
 *
 * Read from the spec, never listed here. The spec retires a page component type
 * in one of two spellings, and both drop the value from `PageComponentType`:
 *
 *   - REFUSED BY NAME — the type is a key of `RETIRED_PAGE_COMPONENT_TYPES`
 *     (`page.zod.ts`), and its row is `retiredComponentProps(type)`: a `never`
 *     that refuses every props bag, `{}` included. It lists no key at all, so
 *     the tombstone reading below cannot see it; the table is the signal.
 *   - ELEMENT GRAIN — no table names the type; the retirement IS the row, kept
 *     with every key it lists a `retiredKey()` tombstone. It lists keys and
 *     accepts none of them.
 *
 * Absence from `PageComponentType` is required and is not enough on its own:
 * the enum is the page-authoring vocabulary, and live blocks sit outside it
 * too — every `object-*` block, and empty-shaped ones such as
 * `cloud-connection:panel`. A row that merely accepts no key is the EMPTY SPEC
 * SHAPE class below, not a retirement.
 */
function isRetiredUpstream(type: string): boolean {
  if ((PageComponentType.options as readonly string[]).includes(type)) return false;
  if (RETIRED_PAGE_COMPONENT_TYPES.has(type)) return true;
  return specTombstonedKeys(type).length > 0 && specTopLevelKeys(type).length === 0;
}

/**
 * ⚠️ WHY FIVE OF THIS FILE'S LEDGERS ARE NOT EMPTY: objectui#11111 decision 3 = B.
 *
 * The maintainer ruled on objectui#11111 (「11111 同意」, record 5902351047)
 * that the 17.5.0 bump re-pins this gate's population and DECLARES NOTHING
 * (Clause ② no). Every difference 17.5.0 newly surfaces is booked here, one
 * entry per difference, each naming the card that owns it and an expiry:
 *
 *   - objectui#11168 — the ten newly carried blocks (the four lazily
 *     registered ones unjudged, the six judged ones' unpublished keys, their
 *     refused input, refused arms and owed member pins), and
 *     `object-form.layout`'s refused arms;
 *   - objectui#8652 — `navigation` on `object-kanban` and `object-calendar`;
 *   - objectui#8649 — `enforceFieldSecurity`, `redactFields` and
 *     `requiredPermissions` on the three `record:*` blocks.
 *
 * The 17.6.0 bump (objectui#11438) books under the same decision, with a
 * fourth owner. objectui#11438 was ruled A′ (record 5965062249): its one group
 * with no owner card, `record:line_items` — which 17.6.0 gives a
 * `ComponentPropsMap` row (objectstack `24c554da`, #21142 / #21244), so this
 * file judges it from that pin on — "follows objectui#11111 decision three B
 * (5902351047): an owner card is filed and ledgered on the trunk with an
 * expiry". The card filed for it is:
 *
 *   - objectui#11536 — every entry on `record:line_items`: the keys its spec
 *     row declares that `inputs` does not publish, and the member pins its
 *     array/object-armed inputs owe. STRUCK by that card's landing, which
 *     declared all ten keys and registered the pins.
 *
 * A fifth owner, under the same bump: objectui#11438 ruling A″ (record
 * 5968177777, the maintainer's order to land 17.6.0 first) books a row whose
 * owner card's slice is not accepted when the row-3 booking is pushed "the
 * same way, to their own cards". Row 1 is such a row:
 *
 *   - objectui#11068 — `object-grid.keyboardNavigation`, the one key on a GA
 *     block that 17.6.0's row declares and `inputs` did not publish. STRUCK by
 *     that card's build, which publishes the key in `GRID_QUERY_INPUTS` together
 *     with its reader (arrow-key cell navigation on the WAI-ARIA grid pattern),
 *     so the card owns no entry now and the four GA blocks carry no OWED entry
 *     again (see THE FOUR GA BLOCKS below).
 *
 * A sixth owner, under the objectstack `main` pin bump (objectui#12971, past
 * `@objectstack/spec` 18.0.0-next.3): the seat decision D1 = A on that card
 * (record 6267645900) applies decision 3 = B to the bump's one group with no
 * owner, `list-view`, which that pin gives a `ComponentPropsMap` row
 * (objectstack#22444), so this file judges it:
 *
 *   - objectui#13047 — every entry on `list-view`: the 38 keys its spec row
 *     declares that `inputs` did not publish, and the 6 member pins its
 *     array/object-armed inputs owed. STRUCK by that card's landing, which
 *     measured each key through the real `SchemaRenderer` and this block's
 *     registration, published the 33 the renderer honours with a member pin
 *     for every structured one, and recorded the other five in
 *     `UNPUBLISHED_EXEMPTIONS` with the measured reason.
 *
 * Each owner card decides every key by its own measurement: declare what the
 * renderer honours, refuse or retire what it does not. ⛔ Batch-declaring an
 * input a renderer does not honour is the failure decision 3 = B exists to
 * avoid, so an entry here is never resolved that way.
 *
 * The ledgers are CAPPED at exactly the entries listed — never unbounded —
 * by `the objectui#11111 ledger is capped at exactly the entries it lists`,
 * which also routes every entry to its owner card and requires its expiry. A
 * new difference beyond the listed entries is still red: every direction below
 * subtracts exact ids, never a block or a prefix. Each owner card's landing
 * strikes its entries and lowers the matching cap in the same change; the last
 * of the five to land restores the empty ledgers and the zero caps this file
 * held before the 17.5.0 bump.
 *
 * EXPIRY. None of these ledgers has a date field, and this repo's SUNSET
 * convention is a condition re-derived from the installed spec, not a date, so
 * nothing here can enforce a calendar deadline. The date is stated in every
 * entry's reason and asserted PRESENT; it is read by the owner cards, not by a
 * clock. The 17.6.0 entries carry their own date, set the same distance from
 * their ruling as the 17.5.0 date is from its own: record 5902351047 was ruled
 * 2026-09-30 and its entries expire 2026-10-30; record 5965062249 was ruled
 * 2026-10-03, so objectui#11536's entries expire 2026-11-02. Record 5968177777
 * (ruling A″) was ruled the same day, so objectui#11068's entry shared that
 * date: it expired 2026-11-02, or when that card's build landed — the build
 * landed first and struck it.
 */
const OBJECTUI_11111_EXPIRES = '2026-10-30';

/** The 17.6.0 bookings' date: objectui#11438 ruling A′ (record 5965062249), plus thirty days; ruling A″ (record 5968177777) is of the same day. */
const OBJECTUI_11438_EXPIRES = '2026-11-02';

/**
 * The owner cards, and nothing else may own an entry: the three decision 3 = B
 * names, objectui#11536, which objectui#11438 ruling A′ filed for the 17.6.0
 * bump's one group with no owner, objectui#11068, whose row ruling A″
 * booked to it, and objectui#13047, which the seat decision on objectui#12971
 * filed for the objectstack `main` pin bump's `list-view` row.
 */
const OBJECTUI_11111_OWNERS = [
  'objectui#11168',
  'objectui#8652',
  'objectui#8649',
  'objectui#11536',
  'objectui#11068',
  'objectui#13047',
] as const;
type Objectui11111Owner = (typeof OBJECTUI_11111_OWNERS)[number];

/** The ruling every entry cites, whichever bump booked it. */
const DECISION_3_B = 'objectui#11111 decision 3 = B (record 5902351047)';

/**
 * The objectstack `main` pin bump's bookings' date (objectui#12971): the seat
 * decision that applied decision 3 = B to it (record 6267645900, 2026-10-19),
 * plus thirty days, the distance every earlier booking kept from its ruling.
 */
const OBJECTUI_12971_EXPIRES = '2026-11-18';

/**
 * Where each owner's entries were booked: the bump that surfaced them, the
 * record that booked them, and their expiry. The 17.5.0 owners were booked by
 * decision 3 = B itself; objectui#11536 by the ruling that applies it to 17.6.0;
 * objectui#11068 by the amendment of that ruling that books row 1.
 */
const OBJECTUI_11111_BOOKINGS: Record<
  Objectui11111Owner,
  { bump: string; bookedBy: string; expires: string }
> = {
  'objectui#11168': { bump: '17.5.0', bookedBy: DECISION_3_B, expires: OBJECTUI_11111_EXPIRES },
  'objectui#8652': { bump: '17.5.0', bookedBy: DECISION_3_B, expires: OBJECTUI_11111_EXPIRES },
  'objectui#8649': { bump: '17.5.0', bookedBy: DECISION_3_B, expires: OBJECTUI_11111_EXPIRES },
  'objectui#11536': {
    bump: '17.6.0',
    bookedBy: `objectui#11438 ruling A′ (record 5965062249), which applies ${DECISION_3_B} to the 17.6.0 bump`,
    expires: OBJECTUI_11438_EXPIRES,
  },
  'objectui#11068': {
    bump: '17.6.0',
    bookedBy: `objectui#11438 ruling A″ (record 5968177777), which books row 1 of the 17.6.0 bump in the shape of ${DECISION_3_B}`,
    expires: OBJECTUI_11438_EXPIRES,
  },
  'objectui#13047': {
    bump: 'objectstack `main` pin (objectui#12971)',
    bookedBy: `the seat decision D1 = A on objectui#12971 (record 6267645900), which applies ${DECISION_3_B} to the objectstack \`main\` pin bump`,
    expires: OBJECTUI_12971_EXPIRES,
  },
};

/** The security triple 17.5.0 declares on exactly the three record blocks (objectui#8649's). */
const FIELD_SECURITY_TRIPLE = ['enforceFieldSecurity', 'redactFields', 'requiredPermissions'];

/** Every entry the ruling books starts with this, so the caps can count them. */
const OWED_PREFIX = 'OWED TO ';

// The two helpers that wrote a booked entry: `OWED_TO` (the reason: owner,
// what is owed, the booking record and the expiry) and `owedEntries` (one
// entry per key of a block). They left with `action:button.undoable`, struck by
// objectui#11168's last slice, came back with the objectstack `main` pin bump
// (objectui#12971), whose `list-view` differences the seat booked to
// objectui#13047 under decision 3 = B (record 6267645900), and left again when
// objectui#13047 struck the last of those entries. A future bump that books an
// entry writes them back with its entries; every reason still starts with
// `OWED_PREFIX`, which the cap test counts.

/** Which owner the ruling routes an entry id to — asserted against every entry's reason. */
function objectui11111OwnerOf(id: string): Objectui11111Owner {
  // The seat decision on objectui#12971 (record 6267645900) routes by BLOCK: every entry on `list-view` is objectui#13047's.
  if (id.slice(0, id.indexOf('.')) === 'list-view') return 'objectui#13047';
  // objectui#11438 ruling A′ routes by BLOCK: every entry on `record:line_items` is objectui#11536's.
  if (id.slice(0, id.indexOf('.')) === 'record:line_items') return 'objectui#11536';
  // Ruling A″ routes by exact ID: row 1 is this one key, and objectui#11068 owns nothing else.
  if (id === 'object-grid.keyboardNavigation') return 'objectui#11068';
  const key = id.slice(id.indexOf('.') + 1).split(':')[0];
  if (FIELD_SECURITY_TRIPLE.includes(key)) return 'objectui#8649';
  if (key === 'navigation') return 'objectui#8652';
  return 'objectui#11168';
}

/** The ruled entries of one ledger. */
const owedIdsOf = (ledger: Record<string, string>): string[] =>
  Object.entries(ledger)
    .filter(([, reason]) => reason.startsWith(OWED_PREFIX))
    .map(([id]) => id)
    .sort();

/**
 * THE CAPS, one per ledger, each EQUAL to the entries listed below. Lower one in
 * the same change as the owner card that strikes its entries; the last owner
 * card to land sets all five to 0.
 */
const OBJECTUI_11111_LEDGER_CAPS = {
  unjudgedBlocks: 0, // objectui#11168 loaded and judged all four: slice 3 object-map and object-tree, slice 4 object-gantt, slice 5 object-timeline
  offSpecInputs: 0, // objectui#11168 slice 1 retired action:group.name
  unpublishedKeys: 0, // objectui#13047: 0 (its landing measured all 38 list-view keys, published the 33 the renderer honours and recorded the other five in UNPUBLISHED_EXEMPTIONS with their reasons); objectui#11168: 0 (its last slice declared action:button undoable, ruling B on objectui#11754; the two `endpoint` entries had left at the 17.6.0 bump, objectui#11438, when the spec stopped declaring the key); objectui#8652: 0, objectui#8649: 0, objectui#11536: 0 and objectui#11068: 0 (each struck by its landing; objectui#11536 declared all ten record:line_items keys, objectui#11068's build published object-grid keyboardNavigation)
  refusedArms: 0, // objectui#11168: slice 2 narrowed element:definition-list.columns, slice 3 object-form.layout
  memberPins: 0, // objectui#13047 pinned list-view data, columns, filter, sort, options and dataSource, with every structured key it published; objectui#11168 slice 2 pinned element:definition-list.items and element:repeater ×3; objectui#11536 pinned record:line_items columns and dataSource
} as const;

/**
 * The third and last place a `ComponentPropsMap` entry may land: blocks this
 * gate CANNOT judge, each with the reason it cannot (objectui#8176).
 *
 * ## Why a ledger and not an absence
 *
 * "Not judged" used to be spelled as absence — a block simply failed both
 * filters and vanished from every set this file computes. Absence is the one
 * state a gate cannot report on, and it is how eight blocks stayed outside this
 * gate unnoticed for its whole life, two of them (`object-calendar`,
 * `object-kanban`) with a real, wrong declaration behind a lazy stub. Fixing
 * those two by loading them (see the import block) closes the instance; this
 * ledger plus `accounts for every spec-carried block` closes the CLASS, because
 * a block can no longer leave the judged population without a line here saying
 * so and a diff someone reviews.
 *
 * ## Three classes, each mechanically checked so an entry cannot rot
 *
 * `every unjudged-block ledger entry still describes a block this gate cannot
 * judge` asserts the reason, not just the name:
 *
 *   - RETIRED UPSTREAM — the spec retired the type and keeps its row only as a
 *     refusal door, so the row accepts no authoring key and neither direction
 *     has a question to ask. Asserted as `isRetiredUpstream(type)`, which reads
 *     the retirement from the spec rather than from a list here, plus
 *     `specTopLevelKeys(type).length === 0` — so the day upstream restores the
 *     type, or gives its row a key, this entry goes red.
 *   - EMPTY SPEC SHAPE — `ComponentPropsMap[type]` accepts no top-level key at
 *     all, so neither direction has a question to ask. Whether this repo happens
 *     to register the block is irrelevant to that, which is why it is the
 *     recorded reason even for the ones the app shell does register — a count
 *     this sentence deliberately does not carry, since nothing pins it and the
 *     pin moves it. Asserted as
 *     `specTopLevelKeys(type).length === 0`, so the day upstream gives one of
 *     these blocks props, this entry goes red and the block gets judged.
 *   - NOT REGISTERED, DELIBERATELY — this repo renders no such block on purpose,
 *     and the refusal is written at the site that refuses. Asserted as absent
 *     from `ComponentRegistry.getKnownTypes()` (lazy stubs INCLUDED, so the
 *     assertion cannot be satisfied by the very stub-blindness objectui#8176 is
 *     about), so registering one of them forces this entry out.
 *   - OWED (objectui#11111 decision 3 = B, record 5902351047) — a block that IS
 *     registered, lazily, and that this file does not load, booked to its
 *     owner card with an expiry (see `OWED_TO`). Asserted as still registered
 *     lazily and still unloaded here, so loading it — the owner card's work —
 *     forces the entry out; and CAPPED at the entries listed, so one more lazily
 *     registered block is still red in `no spec-carried block is registered
 *     but unloaded`. The bump booked four, and objectui#11168 slices 3 to 5
 *     loaded all four, so this class is EMPTY now and its cap is 0.
 *
 * The first class is EXCLUSIVE, and that is what keeps a hand-written reason
 * from outliving a retirement (objectui#10033): an entry under either of the
 * other two reasons FAILS when the spec retires its type. Before that check, a
 * retirement changed what an entry was about and nothing told the entry — two
 * rows the spec retired in the same release sat here under two unrelated
 * reasons, neither of which mentioned the retirement, and one of which cited a
 * palette exclusion that release's reconciliation had deleted.
 *
 * ## Why a retired block stays in this population
 *
 * The population is `Object.keys(ComponentPropsMap)`, and the spec KEEPS a
 * retired type's row on purpose: the row is one of the retirement's refusal
 * doors, and it is what lets every reader that dispatches on the map still
 * recognise the name. Dropping retired rows from the population here would
 * reopen the absence this ledger exists to close — a registration of a retired
 * type in this repo would leave `covered` along with the row, and go unjudged.
 * Kept in, such a registration is judged (every input it publishes is
 * off-spec) and is accounted for twice, which the partition refuses. A ledger
 * entry for a type the map no longer carries at all is the opposite case, and
 * already fails twice over: in the partition's converse and in the rot check.
 *
 * `aria` is not a member of the empty-shape reasoning: it is a key on non-empty
 * shapes and has its own uniform cover in `GLOBALLY_UNPUBLISHED_SPEC_KEYS`.
 */
const UNJUDGED_SPEC_BLOCKS: Record<string, string> = {
  'ai:chat_window':
    'RETIRED UPSTREAM. `@objectstack/spec` 17.7.0 retired it by name (objectstack#21504, landed by objectstack#21531): out of `PageComponentType`, named in `RETIRED_PAGE_COMPONENT_TYPES`, and its row `retiredComponentProps` — a `never` that refuses every props bag, `{}` included, with a message that names the floating chat overlay as the AI chat entry point — so there is no authoring surface for either direction to judge. Until that release it stood here as NOT REGISTERED, DELIBERATELY: `PROTOCOL_COMPONENTS` in `@object-ui/components` `renderers/placeholders.tsx` omits it in so many words, which the retirement now says upstream too. objectui#11717, ledger objectui#8176.',
  'app:launcher':
    'EMPTY SPEC SHAPE. `ComponentPropsMap[app:launcher]` declares no props at all, so there is nothing for either direction to judge. It IS registered — `app-shell/src/views/app-launcher-renderer.tsx` registers it propless for exactly this reason, and says so — but by `@object-ui/app-shell`, which this file does not import; the empty shape is the load-bearing half either way. objectui#8176.',
  'cloud-connection:panel':
    'EMPTY SPEC SHAPE. New in `@objectstack/spec` 17.3.0, which declares it with no top-level key at all, so neither direction has a question to ask. It IS registered — `app-shell/src/console/cloud-connection/CloudConnectionPanel.tsx` registers it propless — but by `@object-ui/app-shell`, which this file does not import; the empty shape is the load-bearing half either way, exactly as for `app:launcher` above. objectui#7122, ledger objectui#8176.',
  'element:filter':
    'RETIRED UPSTREAM. `@objectstack/spec` 17.1.0 retired it at element grain (objectstack#9220, ADR-0049): out of `PageComponentType`, and its row kept with every key a `retiredKey()` tombstone, so it accepts no authoring key and neither direction has a question to ask. objectui#10033, ledger objectui#8176.',
  'element:form':
    'RETIRED UPSTREAM. `@objectstack/spec` 17.3.0 retired it at element grain (objectstack#9249, ADR-0049), the `element:filter` shape one element over: out of `PageComponentType`, and its row kept with every key a `retiredKey()` tombstone whose prescription names the live replacement — the object-bound `object-form` block, which IS registered and IS judged here. objectui#10033, ledger objectui#8176.',
  'global:notifications':
    'EMPTY SPEC SHAPE. Same shape and same reasoning as `app:launcher` above: `app-shell/src/views/global-notifications-renderer.tsx` registers it propless because the spec shape is empty, and that registration is not in this file\'s import graph. objectui#8176.',
  'marketplace:installed-list':
    'RETIRED UPSTREAM. `@objectstack/spec` retired it by name after 18.0.0-next.3 (objectstack#24255, landed as `14a8bd2693`): out of `PageComponentType`, named in `RETIRED_PAGE_COMPONENT_TYPES`, and its row `retiredComponentProps` — a `never` that refuses every props bag, `{}` included, with a message that names the Packages view that replaces it — so there is no authoring surface for either direction to judge. Before that it stood here as EMPTY SPEC SHAPE. New in `@objectstack/spec` 17.3.0, which declared it with no top-level key at all; not registered here since objectui#12733, whose Setup → Packages list filtered to Marketplace carries its actions (`MarketplaceRowActions.installedAppsPins.test.tsx`). objectui#7122, objectui#12733, objectui#12971, ledger objectui#8176.',
  'mcp:connect-agent':
    'EMPTY SPEC SHAPE. New in `@objectstack/spec` 17.3.0, which declares it with no top-level key at all. Registered propless by `@object-ui/app-shell` (`src/console/connect/ConnectAgentWidget.tsx`), outside this file\'s import graph; the empty shape is the load-bearing half either way. objectui#7122, ledger objectui#8176.',
  'record:approval_decision':
    'EMPTY SPEC SHAPE. New in `@objectstack/spec` 18 (objectui#12030), which declares it with no top-level key at all. Registered by `@object-ui/app-shell` (`src/views/record-approval-decision-renderer.tsx`, objectui#12342), outside this file\'s import graph; the empty shape is the load-bearing half either way, exactly as for `app:launcher` above. objectui#12030, ledger objectui#8176.',
  'record:approvals':
    'EMPTY SPEC SHAPE. New in `@objectstack/spec` 18 (objectui#12030), which declares it with no top-level key at all. Registered by `@object-ui/app-shell` (`src/views/record-approvals-renderer.tsx`), outside this file\'s import graph; the empty shape is the load-bearing half either way, exactly as for `app:launcher` above. objectui#12030, ledger objectui#8176.',
  'record:attachments':
    'EMPTY SPEC SHAPE. New in `@objectstack/spec` 18 (objectui#12030), which declares it with no top-level key at all. Registered by `@object-ui/app-shell` (`src/views/record-attachments-renderer.tsx`), outside this file\'s import graph; the empty shape is the load-bearing half either way, exactly as for `app:launcher` above. objectui#12030, ledger objectui#8176.',
  'record:json':
    'RETIRED UPSTREAM. `@objectstack/spec` retired it by name after 18.0.0-next.3 (objectstack#24162, landed as `030a7b83e8`), the only release that declared it: out of `PageComponentType`, named in `RETIRED_PAGE_COMPONENT_TYPES`, and its row `retiredComponentProps` — a `never` that refuses every props bag, `{}` included — so there is no authoring surface for either direction to judge. Before that it stood here as NOT REGISTERED, DELIBERATELY: the maintainer dropped the approval request page\'s raw-payload panel it was declared for (pointer 6232139151 on objectui#12490). objectui#12873, objectui#12971, ledger objectui#8176.',
  // The fourth class, and the only one that is not mechanically "unjudgeable":
  // OWED. The 17.5.0 bump booked four blocks here — new in that spec, registered
  // with `registerLazy` by the console (`register-plugins.ts`) and not loaded by
  // this file, so their declarations were real and unread. The remedy the
  // mechanism test names — an eager import — judges them, and judging them was
  // objectui#11168's work, not the bump's (objectui#11111 decision 3 = B).
  // All four are struck: `object-map` and `object-tree` by objectui#11168
  // slice 3, `object-gantt` by slice 4 and `object-timeline` by slice 5, which
  // load them at the top of this file and published the keys their renderers
  // honour (`MINOR_17_5_LOADED_BLOCKS`). The class is empty, and its cap is 0.
  'user:profile':
    'RETIRED UPSTREAM. `@objectstack/spec` 17.3.0 retired it by name (objectstack#14159, landed by objectstack#15112): out of `PageComponentType`, named in `RETIRED_PAGE_COMPONENT_TYPES`, and its row `retiredComponentProps` — a `never` that refuses every props bag, `{}` included — so there is no authoring surface for either direction to judge. The same release\'s reconciliation here (objectui#7122) took it out of `PROTOCOL_COMPONENTS` in `@object-ui/components` `renderers/placeholders.tsx`, so not even the placeholder scaffold stands in for it. objectui#10033, ledger objectui#8176.',
};

/*
 * `SPEC_SHAPE_EMPTY_ON_THE_PIN` — DELETED on the @objectstack/spec 17.0.0-rc.6
 * bump (objectstack#7100), exactly as it was designed to be.
 *
 * It carved `page:footer` / `page:section` / `page:sidebar` out of the
 * non-empty probe guard because rc.5 still mapped all three to `EmptyProps`,
 * so their shapes resolved to `{}` for a real reason rather than a broken
 * reader (objectui#4027). objectstack#5775 / PR objectstack#6281 replaced that
 * with the shared `PageContainerProps` upstream, and rc.6 is where this repo
 * resolves it: `children` now appears in each of the three shapes.
 *
 * The list was self-clearing by construction, and its companion test — `the
 * empty-shape carve-out still describes an empty shape` — is what fired,
 * carrying its own instruction ("delete it from SPEC_SHAPE_EMPTY_ON_THE_PIN").
 * Both the list and that test are gone; the plain non-empty guard now covers
 * all three again, which is the state the carve-out was always temporary
 * against.
 */

/**
 * Off-spec top-level inputs ACCEPTED for now, each with the reason.
 * Key format: `BLOCK.INPUT`.
 *
 * The bar for an entry is NOT "the renderer reads it". A key the renderer reads
 * is a key worth declaring SOMEWHERE — it is not a key worth declaring in a
 * place the contract rejects. The bar is that the divergence is already owned by
 * a named, open piece of upstream work, because `@objectstack/spec` is not
 * edited from this repo (AGENTS.md #0 / #0.1): "the spec should declare this"
 * is an upstream issue plus an entry here, never a local widening. Every reason
 * therefore has to cite an issue, which `references a tracking issue` asserts.
 *
 * ## EMPTY as of @objectstack/spec 17.0.0-rc.6 (objectui#4167)
 *
 * All twelve entries were deleted on the rc.6 bump, by the `carries no stale
 * exemption` test below, which named every one of them at once. Emptying it is
 * the discipline working end to end rather than an absence of divergence: each
 * entry cited the upstream issue that owned it, and rc.6 is where both of those
 * issues landed. Verified per key against the resolved
 * `ComponentPropsMap[type].shape` at this pin, not from the issues' wording:
 *
 *  - **objectstack#6776** — `page:header` now declares `recordChrome`,
 *    `showStar` and `showCopyId`; `page:accordion` declares `variant`;
 *    `page:tabs` declares `tabStyle`. The five keys the renderer had read all
 *    along are contract now. `showStar` has since left again: the spec
 *    retires it (objectstack#23650, landed as objectstack#23781), so the
 *    renderer stopped reading it and the registration stopped publishing it
 *    (objectui#12627). Its `settledUpstream` row below left with the input. `page:tabs` is the interesting one: the spec
 *    declares BOTH `tabStyle` and `type`, so the carrier collision written up in
 *    the deleted entry was resolved upstream by declaring the alias rather than
 *    by renaming — which is why `page:tabs.type` stays in
 *    `UNPUBLISHED_EXEMPTIONS` below (spec-declared, unpublishable in a flat
 *    carrier) while `tabStyle` needs no cover at all.
 *  - **objectstack#5775 / PR objectstack#6281** — `element:record_picker`
 *    declares `labelField`, `valueField` and `label`; `page:card` declares
 *    `children` (replacing the retired `body`); and `page:section` /
 *    `page:footer` / `page:sidebar` carry the shared `PageContainerProps`, whose
 *    one key is `children`. Those seven were the objectui#4027 stale-pin set,
 *    predicted in their own reasons ("Delete this entry when the pin moves") and
 *    deleted exactly there.
 *
 * The map stays declared rather than removed: a future divergence needs
 * somewhere to be registered, and `exemptedFor` below reads it. Empty is a
 * state, not a deletion — every forward-direction assertion now runs with no
 * cover of any kind, which is the strongest reading this gate has ever had.
 *
 * EMPTY AGAIN since objectui#11168 slice 1. The 17.5.0 bump booked one entry
 * here — `action:group.name`, a published input its new spec row does not
 * accept — to objectui#11168 under objectui#11111 decision 3 = B. That slice
 * measured the key (nothing reads a group-level `name`; the spec refuses it
 * with a prescription) and RETIRED it from the registration, so the entry went
 * stale and was deleted with it. The pin is
 * `packages/components/src/renderers/action/__tests__/action-group-menu-inputs-11168.test.tsx`.
 */
const OFF_SPEC_EXEMPTIONS: Record<string, string> = {};

/**
 * Spec-declared top-level keys deliberately NOT published, each with the reason.
 * Key format: `BLOCK.KEY`. The reverse direction's half of the same discipline
 * as `OFF_SPEC_EXEMPTIONS` above: explicit, reasoned, issue-backed, and deleted
 * by a failing test once it stops describing anything.
 *
 * The bar for an entry is NOT "we haven't got round to it". A spec key the
 * renderer HONOURS and `inputs` omits is a plain defect and gets declared —
 * that is what objectui#3808 did to `record:details.hideFields`,
 * `record:related_list.relationshipValueField`, `record:related_list.add` and
 * `element:text_input.defaultValue`. The bar is that publishing the key would
 * itself be wrong or premature, and WHICH of those it is has to be named:
 *
 *   - the renderer does not read it, so publishing it would advertise
 *     configuration the platform silently drops (the objectui#3797 direction, in
 *     reverse) — the choice between wiring it and declaring it with a KNOWN GAP
 *     is a contract decision, not an implementation detail;
 *   - the installed pin does not declare the key yet, so declaring the input
 *     would fail this file's own forward direction today;
 *   - the key is out of the dispatched scope of the change that added this gate,
 *     and its own issue owns it.
 *
 * ONE CLASS IS GONE, and it is worth knowing which, because it used to be the
 * biggest: "the spec rejects this key by name upstream already". A key the spec
 * REJECTS needs no exemption at all since objectui#3809 — it leaves the accepted
 * set on its own, so nothing demands it and nothing has to license not
 * publishing it. Eight entries of that class were harvested (see the comment at
 * the top of the map). An entry whose reason reduces to "upstream retired it" is
 * therefore the one thing that may never be ADDED here again: it would go
 * dangling-and-stale in the same run that wrote it.
 *
 * Every reason cites an issue, which `references a tracking issue` asserts.
 * Verified against renderer read sites at objectui `origin/main` @ `c25222758`
 * with `@objectstack/spec@17.0.0-rc.6` — not assumed from the spec's wording.
 */
const UNPUBLISHED_EXEMPTIONS: Record<string, string> = {
  /*
   * EIGHT TOMBSTONE ENTRIES HARVESTED HERE — objectui#3809, and they were
   * designed to die exactly this way.
   *
   * `page:header.icon`, `page:card.actions`, `page:tabs.type`,
   * `element:record_picker.displayField` / `.searchFields` / `.multiple`,
   * `page:card.body` and `record:details.layout`. Every one of them existed for
   * the same reason, said so in its own words, and named this issue as the only
   * thing that could resolve it: the key is an ADR-0087 D2 tombstone — retired
   * upstream, and STILL a member of the spec's shape, because D2 retirement
   * replaces the member with `z.never().optional()` rather than deleting it. So
   * the reverse direction, reading raw `Object.keys(shape)`, demanded that this
   * repo publish a key the contract rejects by name, and each entry was cover
   * for that false red.
   *
   * They are not deleted by hand-picking. `specTopLevelKeys` now subtracts
   * tombstones, and the two checks that police this list did the rest: the key
   * is no longer in the accepted set, so `every unpublished-key exemption names a
   * key the spec really declares` reports each as DANGLING, and
   * `carries no stale unpublished-key exemption` reports each as STALE. Both
   * name all eight. Deleting them is the only way to get green, which is the
   * discipline this file's header promises working end to end.
   *
   * THE FIVE UPSTREAM RETIREMENTS these eight came from, kept for the reader who
   * needs to know why none of the keys is coming back — the prescriptions are
   * upstream's, not this repo's:
   *
   *   - objectstack#5775 / PR objectstack#6281 — the `element:record_picker`
   *     trio converges on `labelField` / `valueField` (which this renderer reads
   *     and this repo publishes); `PageCardProps.body` converges on `children`,
   *     the spelling every other container uses and the one `page:card` now
   *     publishes (objectui#4027);
   *   - objectstack#6946 / PR objectstack#7115 — `page:header.icon` (a header's
   *     identity is the record chrome plus each action's own icon),
   *     `page:card.actions` (buttons are authored as components in `children` or
   *     `footer`), and `record:details.layout` (withdrawn here by objectui#3818:
   *     its published `auto` | `custom` semantics were never implemented);
   *   - objectstack#6776 — `page:tabs.type`. This one resolves DIFFERENTLY from
   *     its own entry's prediction, and the difference is worth a sentence. The
   *     entry read it as a live spec key that the flat SDUI carrier cannot
   *     express (a node is `{ type: 'page:tabs', … }`, where `type` is the
   *     dispatch tag, and `validate.ts` lists `'type'` in `BASE_PROPS`), and
   *     called convergence "upstream". Upstream converged: it retired the `type`
   *     spelling in favour of `tabStyle`, which this repo already publishes. So
   *     the carrier collision is not tolerated any more, it is gone — the
   *     contract now has one spelling, and it is the publishable one.
   *
   * Renderer READS of these keys are untouched and stay untouched. A stored
   * document written against the old contract keeps rendering until an ADR-0087
   * D2 conversion rewrites it at load time; a back-compat read is not an
   * authoring surface, so it never belonged in `inputs` (the split
   * `page-header-subtitle-alias` established in `packages/layout`). This harvest
   * withdraws EXEMPTIONS, not capability.
   *
   * WHAT HAPPENS AT THE NEXT PIN BUMP, so nobody reads the next red as a
   * regression: the mechanism is now self-clearing. A key upstream retires after
   * this change enters the shape as a tombstone, leaves the accepted set on
   * arrival, and any exemption covering it goes dangling-and-stale in the same
   * run — no issue needed, no filter to remember.
   *
   * THAT PREDICTION HAS NOW RUN ONCE, AND IT HELD. The paragraph used to say two
   * entries below were queued for it: objectstack `origin/main` tombstoned
   * `targetVariable` on BOTH `element:text_input` and `element:record_picker`
   * while the installed 17.0.0 still carried both as live. The 17.1.0 pin
   * (objectui#5328) delivered those retirements, all three directions named the
   * two entries in the same run, and deleting them was the entire fix —
   * objectui#3834's "should we publish an intent-only key" question having been
   * answered upstream, in the negative. The mechanism needed no maintenance to
   * do that, which is the property worth keeping.
   *
   * DO NOT resolve a tombstone red by declaring the input. That publishes a key
   * the contract rejects by name and fails the forward direction immediately;
   * the two directions of this file are a vice on exactly that move, which is
   * why one of them could not be fixed without the other.
   */

  // `element:record_picker.filter` was the ninth entry here — a real A-class gap
  // that fell out of objectui#3808's three-class triage, exempted only because it
  // was outside that PR's dispatched scope. objectui#3830 declared the input, so
  // the entry stopped describing anything and `carries no stale unpublished-key
  // exemption` demanded its deletion. It is now pinned as DECLARED, by name,
  // alongside #3808's four at the bottom of this file.

  // TWO targetVariable ENTRIES DELETED HERE — objectui#5328, and they died
  // exactly the way the docblock above said they would.
  //
  // `element:text_input.targetVariable` and `element:record_picker.targetVariable`
  // were exempted as the spec's own intent-only "declarative hint" with zero read
  // points repo-wide, pending objectui#3834's question of whether to publish such
  // a key at all. The `@objectstack/spec` 17.1.0 pin answered it upstream, in the
  // negative: both keys arrived as ADR-0087 D2 tombstones, so they left the
  // accepted set and the exemptions covering them went dangling-and-stale in the
  // same run — named by `every unpublished-key exemption names a key the spec
  // really declares`, `carries no stale unpublished-key exemption` and `the
  // tombstoned keys are recognised, not exempted`, all three at once.
  //
  // Deleting them is the whole fix. The tombstone judge recognises both keys now,
  // which is a stronger statement than an exemption ever was: the contract itself
  // rejects them by name.

  // FIVE GA-PENDING ENTRIES DELETED HERE — objectui#4668, and they too were
  // designed to die exactly this way.
  //
  // `page:header.maxVisible` / `page:header.mobileMaxVisible` /
  // `page:tabs.alwaysShowStrip` / `record:details.inlineEdit` /
  // `record:details.showHeader` were a class of their own: publishing them was
  // the RIGHT answer and this file's own bar said so ("a spec key the renderer
  // HONOURS and `inputs` omits is a plain defect and gets declared"). What held
  // them was the installed contract, not a judgement — @objectstack/spec 17.0.0
  // GA declares all five and the then-pinned 17.0.0-rc.6 declared none, so
  // declaring the inputs would have failed the FORWARD direction of this very
  // file, and a forward exemption to cover THAT would have gone stale the moment
  // the pin moved (the collision PR objectui#4660 recorded for `SECRET_MASK`).
  //
  // The GA pin landed (objectui#4636 / PR objectui#4639) and objectui#4668
  // declared all five at their registration sites, which is what made `carries
  // no stale unpublished-key exemption` name every one of them at once —
  // exactly as it killed `element:record_picker.filter` when #3830 declared that
  // one. They are pinned as DECLARED, by name, in `the five GA keys
  // objectui#4668 declared are discoverable` at the bottom of this file: the
  // derived reverse loop goes green just as readily if a declaration is swapped
  // back for an entry here, which is the cheap move and the one thing the pin
  // forbids.
  //
  // One of the five needed more than a declaration, and it is recorded here
  // because this list is where the next reader looks: `page:tabs.alwaysShowStrip`
  // was read ONLY as `schema.properties.alwaysShowStrip`, while `inputs`
  // publishes top-level keys. Measured on a one-tab schema, the flat form every
  // layer of the manifest accepts was dropped by the renderer — so #4668 added
  // the canonical top-level arm in the same change. Publishing a key whose only
  // read is under a different carrier is not a declaration, it is this gate's own
  // failure mode moved one layer in.

  // ── object-grid's own @deprecated legacy spellings — the RULED carve-out ───
  //                                                          (10 keys)
  // A class of its own, and the only part of objectui#4648's option B that is
  // NOT declared. The maintainer ruling of 2026-08-16 on that card reads:
  // "object-grid's own `@deprecated` legacy spellings … are NOT published as new
  // authoring surface — they get reasoned, cited exemptions so a deprecated
  // alias is not hardened."
  //
  // So the reason here is NOT the one every other entry gives. These ten are not
  // undecided, not upstream-owned, and not blocked on anything: the renderer
  // reads all ten and will keep reading them, because documents authored under
  // the old spellings must keep rendering. What is refused is PUBLISHING them —
  // an `inputs` entry is a recommendation to write the key, and recommending a
  // deprecated alias is how a second dialect gets hardened (AGENTS.md #0.1).
  // A back-compat read is not an authoring surface: the same split
  // `page:card.body` records above, and the one `page-header-subtitle-alias`
  // established in `packages/layout`.
  //
  // Each is tagged `@deprecated` in this repo's own `ObjectGridSchema`
  // (`packages/types/src/objectql.ts`), and GA's own `.describe()` text says the
  // same thing from the producer side ("Legacy … fallback, read only when
  // `filter` is absent. Prefer `filter`"). Both authorities agree, which is why
  // this is an exemption rather than an open question. The CANONICAL spelling of
  // each is declared by objectui#4648 in `plugin-grid/src/index.tsx` and named in
  // the reason below, so the pair reads as "write this one instead" rather than
  // as an unexplained hole.
  //
  // THESE DO NOT SELF-RETIRE ON A PIN BUMP, and that is deliberate: unlike the
  // GA-pending five above, no issue owns declaring them later. They retire only
  // if `@objectstack/spec` retires the keys upstream (an ADR-0087 D2 tombstone,
  // which by itself DOES make the entry dangling and stale here, because
  // `specTopLevelKeys` subtracts tombstones — the record_picker trio was
  // harvested that way, and `defaultSort` followed it at 17.3.0)
  // or if objectui un-deprecates a spelling. Do not resolve one by declaring the
  // input; that is the move the ruling refused.
  //
  // Measurement note, reported on objectui#4648 with this change: the ruling
  // enumerated FIVE (`fields` / `staticData` / `selectable` / `pageSize` /
  // `showSearch`) from the fork report's list. Re-deriving the class it named —
  // `@deprecated` in `ObjectGridSchema`, AND declared by GA — measures TEN. The
  // five extra (`showPagination`, `defaultSort`, `defaultFilters`,
  // `resizableColumns`, `title`) are the same class by the same test, so they are
  // carved out with it. `defaultSort` has since been harvested — spec 17.3.0
  // tombstoned it (see the note below), `resizableColumns` followed at 17.7.0 and `defaultFilters` at 18 (objectui#12030), leaving seven. Trimming back to exactly five is a one-line reversal
  // (delete the entry, declare the input); publishing first and withdrawing later
  // is not, which is why the exemption is the direction taken while the card is
  // open.
  'object-grid.fields':
    '@deprecated in ObjectGridSchema ("Use columns instead"); GA describes it as the "Field list fallback used when `columns` is absent". Read as back-compat, deliberately not published as authoring surface — the canonical `columns` IS declared. Ruled carve-out, objectui#4648 (maintainer 2026-08-16).',
  'object-grid.staticData':
    '@deprecated in ObjectGridSchema ("Use data with provider: \'value\' instead"); GA describes it as the "Alternate spelling of `data`". Read as back-compat, deliberately not published — the canonical `data` IS declared. Ruled carve-out, objectui#4648 (maintainer 2026-08-16).',
  'object-grid.selectable':
    '@deprecated in ObjectGridSchema ("Use selection.type instead"); GA describes it as the "Legacy selection shorthand, read only when `selection` is absent. Prefer `selection`". Read as back-compat, deliberately not published — the canonical `selection` IS declared. Ruled carve-out, objectui#4648 (maintainer 2026-08-16).',
  'object-grid.pageSize':
    '@deprecated in ObjectGridSchema ("Use pagination.pageSize instead"); GA describes it as the "Flat page-size shorthand; `pagination.pageSize` wins when both are set". Read as back-compat, deliberately not published — the canonical `pagination` IS declared. Ruled carve-out, objectui#4648 (maintainer 2026-08-16).',
  'object-grid.showSearch':
    '@deprecated in ObjectGridSchema ("Use searchableFields instead"); GA describes it as "read only when `searchableFields` is absent". A boolean cannot say WHICH fields to search, which is why the list is the surface. Read as back-compat, deliberately not published — the canonical `searchableFields` IS declared. Ruled carve-out, objectui#4648 (maintainer 2026-08-16).',
  'object-grid.showPagination':
    '@deprecated in ObjectGridSchema ("Use pagination config instead"); GA describes it as "read only when `pagination` is absent". Read as back-compat, deliberately not published — the canonical `pagination` IS declared. Same ruled carve-out class as the five the ruling enumerated, measured on this branch — objectui#4648 (maintainer 2026-08-16).',
  /*
   * `object-grid.defaultSort` WAS THE NINTH TOMBSTONE HARVESTED HERE —
   * `@objectstack/spec` 17.3.0, and it died the way the eight above did.
   *
   * 17.3.0 converted the key to an ADR-0087 D2 tombstone: its member is
   * `z.never().optional()` and its description opens `[REMOVED] … removed in
   * @objectstack/spec 17 (ADR-0049) — it was the legacy second spelling of
   * `sort` … Rename the key to `sort` and wrap the value in an array`. Read
   * from the installed artifact, not from a changelog: `safeParse` of
   * `{ defaultSort: … }` fails `invalid_type` `expected: 'never'` at that path.
   *
   * So it left the AUTHORABLE set while staying listed, and the two checks that
   * police this list reported it DANGLING and STALE exactly as designed —
   * deleting the entry is the only way to green. The carve-out reason it used
   * to carry is now upstream's own prescription, which is strictly better: the
   * contract refuses the spelling by name and says what to write instead.
   *
   * ⛔ Not resolved by declaring the input. `sort`, the canonical spelling, is
   * declared already, and publishing a key the contract rejects by name is the
   * one resolution the test below forbids in so many words.
   */
  /*
   * `object-grid.defaultFilters` WAS THE ELEVENTH TOMBSTONE HARVESTED HERE —
   * `@objectstack/spec` 18 (objectstack#11509, objectui#12030), the way
   * `defaultSort` above was at 17.3.0 and `resizableColumns` below at 17.7.0.
   * The row now refuses the key by name (`invalid_type`, `expected: 'never'`),
   * so the entry went dangling and stale and was deleted, and the key left
   * `GA_PENDING_UNPUBLISHED_KEYS` and the ruled carve-out list with it.
   */
  /*
   * `object-grid.resizableColumns` WAS THE TENTH TOMBSTONE HARVESTED HERE —
   * `@objectstack/spec` 17.7.0 (objectstack#21445, PR objectstack#21463), the way
   * `defaultSort` above was at 17.3.0.
   *
   * 17.7.0 converted the key to a tombstone: `safeParse` of
   * `{ resizableColumns: true }` fails `invalid_type` `expected: 'never'` at that
   * path, with a message that opens "`object-grid` property `resizableColumns`
   * was removed in @objectstack/spec 17.7.0 (ADR-0049) — it was the legacy
   * second spelling of `resizable`", and `{ resizable: true }` parses. So the
   * key left the AUTHORABLE set while staying listed, and the dangling and
   * stale checks reported it exactly as designed; deleting the entry is the only
   * way to green (objectui#11717). ⛔ Not resolved by declaring the input:
   * `resizable`, the canonical spelling, is declared already. Retiring the
   * renderer's own read of the old spelling is objectui#6152's.
   */
  'object-grid.title':
    '@deprecated in ObjectGridSchema ("Use label instead"); GA describes it as the "Fallback for `label` (the renderer reads `label || title`)". Read as back-compat, deliberately not published — the canonical `label` IS declared. Same ruled carve-out class as the five the ruling enumerated, measured on this branch — objectui#4648 (maintainer 2026-08-16).',

  // ── objectui#8176: the two lazily-registered blocks, judged for the first ──
  //     time. ONE key left of the eighteen that entered, and as of objectui#8201
  //     slice 2 it is no longer A DECLARATION SOMEONE OWES.
  //     `object-kanban.quickAdd` is the RULED CARVE-OUT arm of the choice this
  //     map's docblock above requires an entry to name: the PM ruled it
  //     PREMATURE (objectui#8201, Q1 = A, 2026-09-07), and objectui#8285 owns
  //     the fix. `LAZY_BLOCK_RULED_CARVE_OUTS` below is where that ruling is
  //     recorded MECHANICALLY, which is what takes the key out of the backlog
  //     the ceiling counts — the reason text alone could not, since the ceiling
  //     reads keys and not prose.
  //
  //     ⚠️ IT STARTED AT EIGHTEEN, and the two that left are the ledger doing
  //     its job rather than a correction to it. `object-kanban.filter` and
  //     `object-calendar.filter` were objectui#7712's two keys; objectui#8186
  //     landed that declaration on all six registrations while this branch was
  //     open, which made both entries STALE — `carries no stale unpublished-key
  //     exemption` named them by name and stayed red until they were deleted
  //     here. That is the documented exit written into the ⛔ note below,
  //     observed on a real landing: a declaration retires its own cover.
  //
  //     These are NOT a new divergence. The registrations and the spec entries
  //     are unchanged; what changed is that this file now loads the two plugin
  //     packages, so `getConfig` answers for them and the reverse direction
  //     reaches them at all. Eighteen is the "dozens" case this file already
  //     owns a route for (see the member-pin transition note below): list them
  //     BY NAME, cite the issue that owns each, and let the existing dangling
  //     and stale checks force their deletion the moment a key is declared.
  //     `the objectui#8176 backlog has a ceiling` below stops the list growing.
  //
  //     ⛔ Not a licence to keep them unpublished — the bar is unchanged. A key
  //     the renderer honours gets DECLARED at its registration site, and the
  //     entry goes stale in the same change.
  // `object-kanban.filter` and `object-calendar.filter` stood here until
  // objectui#8186 declared them. Deleted, not updated — see the ⚠️ note above.
  // `object-calendar.sort` stood here until objectui#8171 declared it on both
  // `plugin-calendar` registrations (PR objectui#8223). Deleted, not updated —
  // the same documented exit the two `filter` entries took above, observed here
  // a second time.
  //   ⚠️ objectui#8201 took SEVEN more by the same exit, and WHICH seven is the
  //   slice boundary that card argued rather than an alphabet, so it is
  //   recorded here: `object-kanban`'s `groupBy`, `cardTitle`, `titleField`,
  //   `swimlaneField` and `coverImageField`, and `object-calendar`'s
  //   `defaultView` and `locale`. Every one of the seven is SCALAR-ARMED
  //   (`string`, or the three-member `enum`), so objectui#8212's tightened
  //   direction adds nothing to its obligation: `structuredInputs` below is
  //   keyed off the DECLARED arm, a scalar arm never enters that population,
  //   no `MEMBER_PINS` entry is owed and `MEMBER_PIN_EXEMPTION_CEILING` does
  //   not move. That is the MECHANICAL statement of the boundary, which is why
  //   it was chosen over "by package" — it is checkable rather than tasteful.
  //   The eight left behind were array/object-armed (`data`, `cardFields`,
  //   `grouping`, `conditionalFormatting`, `staticData`), coupled to one
  //   (`object-calendar.loading`, inert unless `data` is authored because
  //   `ObjectCalendar.tsx` applies it only under `hasExternalData`), or
  //   ESCALATED (`object-kanban.quickAdd` — measured NOT honoured, since
  //   `KanbanImpl` gates the control on `quickAdd && onQuickAdd` and nothing on
  //   the `ObjectKanban` path supplies that runtime slot; whether that is a
  //   permanent carve-out or a feature gap is a product ruling, so the entry
  //   stays as-is until the maintainer rules).
  //   ⚠️ objectui#8313 then took the FOUR `object-kanban` array/object-armed
  //   keys by the same exit, and paid objectui#8212's second obligation in the
  //   same change: each has a `MEMBER_PINS` entry below, none has a member-pin
  //   EXEMPTION, and `MEMBER_PIN_EXEMPTION_CEILING` DID NOT MOVE for them — a
  //   declaration entering the member population must be answered with a pin
  //   rather than with room, which is the whole point of that ratchet.
  //   ⚠️ What the ceiling READ at that moment is deliberately not written here:
  //   it ratchets down under every later slice, so the figure would be false by
  //   the next one. The rule — "a new array key gets a pin, never room" — is
  //   what survives; the number is the declaration's. The four sinks were measured separately and
  //   only one of the four questions is the pass-through the `filter` pins
  //   answer; the `pins` prose on each entry says which. `object-calendar`'s
  //   three (`data`, `staticData`, `loading`) are untouched by that card — they
  //   are the other package, split out under the Q2 = B ruling on objectui#8201.
  //   ⚠️ objectui#8314 THEN TOOK THOSE THREE by the same exit — slice 2b, the
  //   other half of the Q2 = B split — and with them the LIST'S WHOLE
  //   `object-calendar` REMAINDER: `data`, `staticData` and
  //   `loading` are all declared on both `plugin-calendar` registrations, with
  //   a `MEMBER_PINS` entry apiece for the two array keys (registered below,
  //   never an exemption — objectui#8212's three-part obligation). Every
  //   `object-calendar` key the spec declares is now discoverable, and with
  //   objectui#8313's four gone too the entire remaining list is one key:
  //   `object-kanban.quickAdd`, the escalated one — and objectui#8201's slice 2
  //   then ruled THAT one (PM Q1 = A, PREMATURE, objectui#8285 owns the fix),
  //   which empties the BACKLOG without emptying the map. The entry below is
  //   still live cover for a key the spec still declares; what changed is that
  //   nobody owes a declaration for it any more.
  //   ⚠️ The `loading` clause above was slice 1's REASONING and objectui#8314
  //   measured it: authored `loading: true` replaces a `data`-fed calendar with
  //   its loading placeholder and does nothing at all to a `staticData`-fed
  //   one. The prediction held, so the key was declared on exactly those terms
  //   — its published description names the coupling rather than hiding it.
  //   ⚠️ One correction that outlives the entries, recorded because a future
  //   reader would otherwise inherit the cheap reading of `data`. "An authored
  //   `data` skips the calendar's own fetch" is TRUE ON BOTH CARRIERS and
  //   therefore cannot fail as a pin: `SchemaRenderer` spreads non-metadata
  //   node keys as React props, so the same array is `rest.data` at the
  //   renderer boundary AND `schema.data` inside the component, where the
  //   record-source ladder returns it verbatim as a config that carries no
  //   `provider` and so matches no fetch branch either. Measured by ablation on
  //   objectui#8314: with the boundary's forward removed, "no query was issued"
  //   stayed green while every row asserting the authored ROWS ARE DRAWN went
  //   red. The pin registered below rests on the rows.
  //   ⚠️ One correction that outlives the entry, because the rider note that
  //   stood here asserted the opposite and a future reader would inherit it:
  //   `sort` is NOT a pass-through key, and its member claim is NOT the
  //   identity-forwarding one the two `filter` pins make. `ObjectCalendar.tsx`
  //   writes `$orderby: convertSortToQueryParams(schema.sort)`, and that sink
  //   BUILDS a `field -> direction` map rather than handing the authored array
  //   to the query — so `toBe` on `$orderby` is false about this key and could
  //   never have passed. The pin registered below asserts what is READ inside a
  //   member instead (`field`, `order`, an omitted `order` meaning ascending,
  //   and a member with no usable `field` dropped rather than invented). That
  //   is a SHARPER member claim than a pass-through, not a weaker one.
  // `object-kanban.quickAdd` — the RULED CARVE-OUT (PREMATURE; PM ruling on
  // objectui#8201, Q1 = A) whose entry stood here — was HARVESTED at the
  // `@objectstack/spec` 17.5.0 bump (objectui#11073). Its named exit landed:
  // objectui#8285's ruled retirement took the key out of the spec's accepted
  // set (typed `never`, refused by name), the entry went dangling AND stale in
  // the same run, and deleting it was the only way back to green, exactly as
  // the eight ADR-0087 tombstones before it. The tombstone pin below now names
  // it, so it cannot come back as an exemption or as a published input.

  // ── record:reference_rail.entries — a nested collection, newly JUDGED ──────
  //                                                                   (1 key)
  // The gap is not new; being GATED is. `@objectstack/spec` 17.1.0 added
  // `record:reference_rail` to `ComponentPropsMap` (37 entries to 42), so this
  // file began judging a block it had never covered — the
  // `ComponentRegistry.register('reference_rail', …)` call in
  // `plugin-detail/src/index.tsx` has always published `hideEmpty` and only
  // `hideEmpty`. Nothing about the renderer or its inputs changed on the pin
  // (objectui#5328).
  //
  // `entries` is an ARRAY OF OBJECTS — `{objectName, relationshipField, title,
  // limit, displayField}` per item — and `inputs` is a flat carrier of scalar
  // fields (`type: 'string' | 'number' | 'boolean' | 'enum'`). The same
  // "unpublishable in a flat carrier" reading `page:tabs.type` carried, except
  // here the carrier cannot express the SHAPE rather than colliding on a name.
  //
  // DO NOT resolve this by declaring a scalar input for it: a string field
  // standing in for a list of related-object bindings recommends a write the
  // renderer cannot honour, which is this gate's own failure mode one layer in
  // (the `page:tabs.alwaysShowStrip` note above).
  //
  // NOT blocked on a contract question any more — that half is settled. The
  // maintainer ruled Option B (2026-08-22) and objectui#5494 landed it:
  // `ReferenceRailEntry` is now DERIVED from `@objectstack/spec/ui`
  // (re-exported, never re-declared — `check:spec-symbols` enforces that), and
  // the `icon` key the old local interface carried retired with the
  // derivation. The spec's `ReferenceRailEntrySchema` is `$strict` over
  // {objectName, relationshipField, title?, limit?, displayField?} and refuses
  // `icon` at save, so it survives on neither side of the contract.
  //
  // The note this replaces also asserted that the renderer READ that key. It
  // did not — that premise was false when it was written, which is the whole
  // reason this block was rewritten (objectui#5792). Measured twice,
  // independently: the spec's `ui-reference-rail-unknown-keys-refused`
  // migration entry, and a grep over `plugin-detail/src` where the only
  // surviving `icon` mention in `record-reference-rail.tsx` is prose, while the
  // same grep finds real reads of `entry.objectName`, `.relationshipField`,
  // `.title`, `.limit` and `.displayField`. So the SHAPE limit above is the
  // entire justification for this exemption — it always was sufficient alone.
  'record:reference_rail.entries':
    'An array of {objectName, relationshipField, title, limit, displayField} objects; `inputs` is a flat scalar carrier and cannot express it. Newly judged rather than newly missing — @objectstack/spec 17.1.0 added record:reference_rail to ComponentPropsMap, and the registration (the reference_rail register call in plugin-detail/src/index.tsx) has always published only `hideEmpty` — the 17.1.0 pin, objectui#5328. The flat-carrier shape limit is the entire reason: the `icon` divergence that once also blocked an entries editor was settled by Option B (maintainer 2026-08-22, objectui#5494).',
  // `record:related_list.parentDataSource` — booked here by objectui#12370 (the 18.0.0-next.1 bump)
  // while no renderer read it — is STRUCK: objectui#12294's related-list leg wired the read
  // (`ParentRecordBinding`) and declared the key on the registration, with its member pin in
  // `MEMBER_PINS`, so the entry went stale and `carries no stale unpublished-key exemption` would
  // refuse it.

  /*
   * ⚠️ THE 17.5.0 BOOKINGS — objectui#11111 decision 3 = B (record 5902351047).
   *
   * The spec keys 17.5.0 newly declared on judged blocks that `inputs` did not
   * publish (57 at the bump). The bar at the top of this map says a key the
   * renderer honours "gets declared"; the ruling decided WHO declares, and it
   * is not the bump: each owner card measures each key against its renderer
   * and declares what is honoured, refuses or retires the rest. Booked here,
   * not declared, so the bump adds nothing to the public surface (Clause ② no).
   * Capped at `OBJECTUI_11111_LEDGER_CAPS.unpublishedKeys` by `the
   * objectui#11111 ledger is capped at exactly the entries it lists`, which
   * each owner card's landing lowers.
   */
  // objectui#11168 slice 1 measured every `action:button` / `action:icon` key
  // below through the real `SchemaRenderer` and `ActionRunner` and DECLARED the
  // ones honoured on the block path — all but three, which the slice held
  // back with its measurement and a question for the card. The pins are
  // `packages/components/src/renderers/action/__tests__/action-button-icon-inputs-11168.test.tsx`.
  // Two of the three, `endpoint` on `action:button` and on `action:icon`, left
  // at the 17.6.0 bump (objectui#11438): 17.6.0 refuses `endpoint` on both
  // blocks (objectstack `b3917d90`, the rename to `target`), so the entries no
  // longer named a key the spec declares and `every unpublished-key exemption
  // names a key the spec really declares` went red on them. The third,
  // `action:button.undoable`, is STRUCK: ruling B on objectui#11754 (record
  // 6030342264) had the block hand the runner the record in scope as the Undo
  // baseline its `operation: update` path reads, and the key is DECLARED on
  // the block's `inputs`
  // (`packages/components/src/renderers/action/__tests__/action-button-undoable-11168.test.tsx`).
  // It was objectui#11168's last entry, so every owner's count below is 0.
  // `action:group`'s `location` / `visible` and `action:menu`'s `size` /
  // `visible` stood here until objectui#11168 slice 1 measured each against its
  // renderer through the real `SchemaRenderer` and DECLARED all four — the
  // documented exit: a declaration retires its own cover.
  // objectui#8652's two entries — `navigation` on `object-kanban` and
  // `object-calendar` — are STRUCK: that card declared the key on both blocks'
  // `inputs` (and on both `@object-ui/types` faces), with a member pin apiece
  // in `MEMBER_PINS`, so each entry went stale and `carries no stale
  // unpublished-key exemption` would refuse it.
  // objectui#8649's nine entries — the field-security triple on `record:details`,
  // `record:highlights` and `record:related_list` — are STRUCK: that card
  // declared all three keys on the three blocks' `inputs`, with the contract's
  // types and describe text, so each entry went stale and `carries no stale
  // unpublished-key exemption` would refuse it.

  // ⚠️ THE 17.6.0 BOOKINGS — objectui#11438 ruling A′ (record 5965062249).
  // objectui#11536's ten entries — `parentObject`, `parentId`, `recordId`,
  // `title`, `readonly`, `minRows`, `maxRows`, `filter`, `sort` and `limit` on
  // `record:line_items` — are STRUCK: that card measured each key through the
  // real `SchemaRenderer` and this block's registration, found every one moving
  // the panel, and DECLARED all ten on the block's `inputs`
  // (`packages/plugin-form/src/__tests__/lineItemsDeclaredInputs-11536.test.tsx`),
  // so each entry went stale and `carries no stale unpublished-key exemption`
  // would refuse it.

  // objectui#11068's one entry — row 1 of the 17.6.0 bump,
  // `object-grid.keyboardNavigation`, booked by objectui#11438 ruling A″
  // (record 5968177777) — is STRUCK: that card's build published the key in
  // `GRID_QUERY_INPUTS` together with its reader, so the entry went stale and
  // `carries no stale unpublished-key exemption` would refuse it.

  // ── objectui#12085: the element-layer flat binding keys objectstack#11509 retires ──
  // Six entries stood here — `element:repeater.object` / `.filter` / `.sort` /
  // `.limit` and `element:number.object` / `.filter` — each "dies on its own at
  // the pin that carries the tombstones". `@objectstack/spec` 18 is that pin
  // (objectui#12030): every one of the six is a tombstone now, so each entry
  // went dangling and stale and was deleted. The repeater reads none of its
  // four either (objectui#12345), and nothing here publishes the keys.

  /*
   * ⚠️ THE OBJECTSTACK `main` PIN BOOKINGS — the seat decision D1 = A on
   * objectui#12971 (record 6267645900), which applies objectui#11111 decision
   * 3 = B to the pin bump. STRUCK by objectui#13047.
   *
   * The bump booked the 38 spec keys the `list-view` row declares from that
   * pin on (objectstack#22444) that the registration's `inputs` did not
   * publish, OWED to objectui#13047. That card measured each key through the
   * real `SchemaRenderer` and the `list-view` registration
   * (`packages/plugin-list/src/__tests__/ListViewBlock.specInputs-13047.test.tsx`),
   * published the 33 the renderer honours on a page node, and left the five
   * below out, each UNPUBLISHED BY MEASUREMENT: the first bar of this map's
   * header, a key the renderer does not honour, so publishing it would
   * advertise configuration the platform drops. Each reason names what the
   * renderer does instead, and each leaves this map the day a reader lands
   * and the key is published. objectui#13074 struck one of the five:
   * `requiredPermissions`, which `ListViewBlock` now honours on a page node
   * (`ListViewBlock.inertKeys-13074.test.tsx`). objectui#13089 struck
   * `addRecord`, whose Add button the console's page host now serves a create
   * for (`PageView.listViewAddRecord-13089.test.tsx`). The pin move to
   * `@objectstack/spec` 18.0.0 (objectui#13261) struck `filterableFields`: the
   * row carries the spec's retirement tombstone there (objectstack#24640), so
   * the key is a harvested tombstone, not an unpublished live key.
   */
  'list-view.name':
    'Unpublished by measurement (objectui#13047): read by nothing on a page `list-view` node. The node draws, queries and hands its view the same thing with and without it — the view\'s own `name` is its identity in metadata, which an embedded list has no use for.',
  'list-view.sharing':
    'Unpublished by measurement (objectui#13047): `sharing.type` draws a Share button with no click handler, and the sharing config is enforced nowhere in the renderer. Publishing it would advertise a dead control (objectui#13047\'s report).',
};

/**
 * Exemption ids on a newly-judged block that have been RULED rather than owed.
 *
 * The backlog ceiling below counts `UNPUBLISHED_EXEMPTIONS` entries on
 * `LAZY_REGISTERED_BLOCKS`, and until objectui#8201's slice 2 every one of them
 * was the same thing: a declaration someone owed. That is no longer true of
 * `object-kanban.quickAdd`, so counting it as backlog reports work nobody is
 * going to do. The ruling is therefore recorded HERE, as data, and subtracted.
 * The reason text cannot carry it: the ceiling reads KEYS, and no assertion can
 * read prose.
 *
 * ## ⚠️ What moving the number 1 -> 0 does NOT buy, measured rather than argued
 *
 * It does NOT close a hole. The obvious story — "a ceiling one above the real
 * number banks headroom, so a fresh divergence could be greened by writing an
 * entry under it" — is FALSE here, and the ablation on objectui#8201's slice 2
 * says so rather than reasoning about it. The same fresh divergence (a declared
 * key removed from `OBJECT_KANBAN_INPUTS` and greened with a new entry) was run
 * against BOTH shapes of this ceiling: it reddens at `expected 1 to be less
 * than or equal to 0` on this branch, and at `expected 2 to be less than or
 * equal to 1` on the shape that preceded it. The `toBe` half is EXACT in both
 * directions, so growth was already refused at 1; there was never headroom to
 * bank.
 *
 * ⇒ What the move buys is that the number stays TRUE. It is a MEASUREMENT of
 * how many declarations are owed on these two blocks, and after the ruling that
 * count is zero. Leaving it at 1 would have made this ceiling say one is owed
 * when none is — the same stale-number-beside-a-correct-assertion drift this
 * file has already had to correct twice (see the ladder in the ceiling's own
 * comment). A ratchet whose number has stopped describing anything is the thing
 * a reader stops trusting.
 *
 * ## Three things make this a record of a ruling and not a new hiding place
 *
 * `the one ruled carve-out on a newly judged block is real` below asserts all
 * three, because a subtraction that licensed anything would be strictly worse
 * than the ceiling it adjusts:
 *
 *   1. PINNED BY NAME. The list is asserted to equal exactly this one id. A
 *      second entry cannot ride in on the mechanism — adding one is a visible
 *      edit to a pinned literal, which is the same bargain
 *      `NEWLY_JUDGED_UNPINNED_MEMBERS` makes one layer in.
 *   2. NON-VACUOUS. Every id must really carry an `UNPUBLISHED_EXEMPTIONS`
 *      entry on a lazy-registered block, so the list cannot claim credit for
 *      cover that is not there, nor quietly reach a key on some other block.
 *   3. IT NAMES ITS OWNING CARD. Every id's reason must cite objectui#8285.
 *      ⭐ This is the mechanical difference between the ruling that was made
 *      and the one that was refused. PREMATURE (Q1 = A) says the renderer does
 *      not honour the key TODAY and names who owns the fix, so an owning card
 *      must exist and stay open. The rejected reading — that the object-bound
 *      board is not going to grow quick-add — needs no owning card at all, and
 *      would have closed objectui#8285 as not-planned. An entry that stopped
 *      naming the card would have quietly become the stronger claim, and this
 *      row is what stops that happening silently.
 *
 * ## How this list empties
 *
 * ⛔ NOT by a declaration — that resolution is forbidden for this key, since
 * the renderer cannot honour it. objectui#8285 was ruled (director seat
 * 2026-09-08, decision batch #91) to retire `object-kanban.quickAdd` from the
 * spec's `ComponentPropsMap`. When that lands, the key leaves the accepted set,
 * the exemption entry goes dangling AND stale, and deleting it is the only way
 * back to green — at which point assertion 2 above fails until this list is
 * emptied in the same change. The two halves cannot drift apart.
 *
 * ⭐ EMPTIED at the `@objectstack/spec` 17.5.0 bump (objectui#11073), by exactly
 * that route: 17.5.0 carries objectui#8285's retirement, `quickAdd` is a
 * tombstone, its exemption entry was deleted, and this list emptied in the same
 * change. The three assertions above now read an empty list; the tombstone pin
 * names the key instead.
 */
const LAZY_BLOCK_RULED_CARVE_OUTS: string[] = [];

/**
 * Exemption entries whose KEY the installed spec is allowed not to declare yet.
 *
 * Every other entry in `UNPUBLISHED_EXEMPTIONS` describes a key the installed
 * spec declares right now — that is what `every unpublished-key exemption names
 * a key the spec really declares` asserts, and it is why a typo cannot hide in
 * the list. These ten describe keys of a block only @objectstack/spec 17.0.0 GA
 * carries, so on a pin predating the GA element set they describe nothing yet.
 *
 * Pinning them as a SET rather than skipping "any entry the spec does not
 * declare" is the whole safety of the mechanism: only these entries may be
 * dormant, and `every GA-pending exemption arms exactly with the installed
 * spec` asserts that their dormancy tracks the installed element set in BOTH
 * directions — so a GA release that dropped one of them fails here instead of
 * leaving an entry that quietly covers nothing.
 *
 * ONE GROUP NOW, and knowing which one LEFT matters more than the one that
 * stayed:
 *
 *   - the ten `object-grid` entries are objectui#4648's RULED carve-out. They
 *     are dormant only on a pin that does not carry `object-grid` at all, so
 *     none of its keys resolves; on a GA tree they are fully judged. They are
 *     not awaiting declaration — see their reasons above;
 *   - the FIVE that were listed first here (`page:header.maxVisible`,
 *     `page:header.mobileMaxVisible`, `page:tabs.alwaysShowStrip`,
 *     `record:details.inlineEdit`, `record:details.showHeader`) were the other
 *     kind: keys on blocks the pin already carried, awaiting declaration. They
 *     retired the way this mechanism intends — the pin moved to GA, objectui#4668
 *     declared all five, and their exemption entries went stale in the same run.
 *     A "pending" entry that never lands is the rot this set exists to make
 *     visible; these five are the worked example of it not happening.
 *
 * So the two arms of `isDormantOnThisPin` are no longer symmetric in practice:
 * a future entry here is either a ruled carve-out on a block the pin may not
 * carry, or a declaration someone owes. Say which in the reason.
 */
const GA_PENDING_UNPUBLISHED_KEYS = [
  'object-grid.fields',
  'object-grid.staticData',
  'object-grid.selectable',
  'object-grid.pageSize',
  'object-grid.showSearch',
  'object-grid.showPagination',
  'object-grid.title',
];

/** Split a `BLOCK.KEY` exemption id into its two halves. */
const splitExemptionKey = (exemptionKey: string): [string, string] => {
  const dot = exemptionKey.indexOf('.');
  return [exemptionKey.slice(0, dot), exemptionKey.slice(dot + 1)];
};

/**
 * Is this a GA-pending entry the installed spec does not carry? Such an entry
 * is judged by neither the dangling nor the stale check — both of those ask
 * questions about a key that does not exist on this pin.
 *
 * `specListedKeys`, NOT the narrowed accepted set, and the difference is the one
 * objectui#3809 is about (see that function's own note). Dormancy is a question
 * about the RELEASE: does this pin know the key at all? A tombstone answers YES
 * — the release knows it and refuses it — so an exemption covering a retired key
 * must stay LIVE and be reported as dangling-and-stale, which is what forces its
 * deletion. Asking the narrowed set here would call every future retirement
 * "dormant" and hand a retired key's exemption a permanent hiding place, which
 * is the same blind spot one layer down.
 */
const isDormantOnThisPin = (exemptionKey: string): boolean => {
  if (!GA_PENDING_UNPUBLISHED_KEYS.includes(exemptionKey)) return false;
  const [type, specKey] = splitExemptionKey(exemptionKey);
  return !specListedKeys(type).includes(specKey);
};

/*
 * THE FOUR GA BLOCKS — RULED AND RESOLVED, objectui#4648 (maintainer 2026-08-16).
 *
 * On a GA tree `object-form` / `object-grid` / `object-master-detail-form` /
 * `object-metric` enter `covered` (see `GA_ONLY_BLOCKS`) and the reverse
 * direction judges the 78 spec keys their `inputs` did not publish. That red is
 * now resolved the way this file's own bar prescribes — "a spec key the renderer
 * HONOURS and `inputs` omits is a plain defect and gets declared" — because the
 * implementation measurement that forked the card's first ruling showed all 78
 * ARE honoured today, either off `schema.*` in the renderer or through
 * `SchemaRenderer`'s rest-prop spread onto components whose props declare them
 * one for one. The maintainer re-ruled on that measurement (option B):
 *
 *   - 68 keys are DECLARED, at the four registration sites —
 *     `plugin-form/src/index.tsx` (`object-form` +20, `object-master-detail-form`
 *     +10), `plugin-grid/src/index.tsx` (`object-grid` +21 in
 *     `GRID_QUERY_INPUTS`), `plugin-dashboard/src/index.tsx` (`object-metric`
 *     +14). No exemption is owed for a declared key and none is written;
 *   - 10 are the ruled CARVE-OUT — `object-grid`'s own `@deprecated` legacy
 *     spellings, which are exempted rather than declared so a deprecated alias is
 *     not hardened into a second dialect. Their entries are in
 *     `UNPUBLISHED_EXEMPTIONS` above, each naming the canonical spelling that IS
 *     declared in its place.
 *
 * The bar was NOT amended: option B is the arm that needed no amendment, which
 * is one of the reasons the ruling chose it.
 *
 * The exemption list is therefore the carve-out and nothing else. A future key
 * these blocks gain is a plain A-class defect: declare it at the registration
 * site. Do not add an entry here to silence one.
 *
 * ⚠️ ONE BOOKED EXCEPTION STOOD HERE, BY RULING AND WITH AN EXPIRY, and is
 * STRUCK. objectui#11438 ruling A″ (record 5968177777) booked row 1 of the
 * 17.6.0 bump, `object-grid.keyboardNavigation`, OWED TO objectui#11068, until
 * that card declared it at the registration site together with its reader. Its
 * build did, and struck the entry. `the four GA blocks resolve their ruled
 * split` now admits no OWED entry on these four blocks, so the rule above holds
 * for every key again.
 */

const exemptedFor = (type: string): string[] =>
  Object.keys(OFF_SPEC_EXEMPTIONS)
    .filter((key) => key.startsWith(`${type}.`))
    .map((key) => key.slice(type.length + 1));

const unpublishedExemptedFor = (type: string): string[] =>
  Object.keys(UNPUBLISHED_EXEMPTIONS)
    .filter((key) => key.startsWith(`${type}.`))
    .map((key) => key.slice(type.length + 1));

// ── the ARM direction (objectui#4971) ────────────────────────────────────────
//
// Same `covered` set, same derived-not-restated expectations, same exemption
// discipline as the two key-name directions above. What moves is the SUBJECT:
// not which keys a block publishes, but which coarse KINDS it publishes them
// with. One direction only — see the header: widening is silent, narrowing is
// merely noisy.

/**
 * One Zod issue, as far as the arm judge needs to see it.
 *
 * Structural rather than imported: the contract's issues arrive as plain data
 * through `safeParse`, and the three fields read here (`code`, `path`, and the
 * per-branch `errors` of a union) are the stable shape of that data. `keys` is
 * the `unrecognized_keys` payload — see `specArmVerdict`.
 */
interface SpecIssue {
  code?: string;
  path?: readonly unknown[];
  keys?: readonly string[];
  values?: readonly unknown[];
  errors?: readonly (readonly SpecIssue[])[];
}

interface SpecParser {
  safeParse: (value: unknown) => { success: boolean; error?: { issues?: readonly SpecIssue[] } };
}

/** This block's spec props schema as a parser, or `null` when this pin has none. */
function specParser(type: string): SpecParser | null {
  const schema = specSchema(type) as Partial<SpecParser> | undefined;
  return typeof schema?.safeParse === 'function' ? (schema as SpecParser) : null;
}

/**
 * Representative values per coarse arm, in the vocabulary `armAccepts` uses
 * (`packages/sdui-parser/src/validate.ts`) — the arms are KINDS, so one value
 * of the kind is what witnesses it.
 *
 * More than one per structured kind on purpose. `[]` witnesses any array
 * contract regardless of its element type, and `{}` witnesses an object
 * contract whose members are all optional; the second entry is what witnesses
 * the opposite case — a contract with required members, where the empty value
 * fails on CONTENT (which `specArmVerdict` reads as the kind being accepted).
 * Either one answering is enough, which is why the verdict is `some`, not
 * `every`.
 *
 * `color` / `date` / `code` / `file` are the string-family kinds `armAccepts`
 * treats as `typeof value === 'string'`. No registration in this repo declares
 * one today, so their probes are unexercised vocabulary rather than measured —
 * they are here so that a first such declaration is JUDGED rather than silently
 * unjudged, which is what `the probe vocabulary covers every arm a manifest can
 * carry` asserts.
 */
const COARSE_ARM_PROBES: Record<string, readonly unknown[]> = {
  string: ['Account'],
  number: [42],
  boolean: [true],
  array: [[], ['Account']],
  object: [{}, { en: 'Account', 'zh-CN': '客户' }],
  color: ['#336699'],
  date: ['2026-01-01T00:00:00.000Z'],
  code: ['const total = 1;'],
  file: ['logo.png'],
};

/**
 * Arm kinds that carry no value-shaped claim, and so cannot be compared to a
 * contract at all. Listed, never silent (the header's exemption rule).
 *
 * `slot` is the whole list: it names a CHILD POSITION rather than a value, and
 * `armAccepts` admits everything for it (`default: return true`), so "the spec
 * accepts some value of this kind" is not a question about the declaration.
 * `page:card.children` / `.footer` and the three `page:*` container `children`
 * are the five that use it.
 */
const ARM_KINDS_WITHOUT_A_VALUE_CLAIM = new Set(['slot']);

/**
 * The coarse kind of a value, in `armAccepts`'s vocabulary
 * (`packages/sdui-parser/src/validate.ts`).
 *
 * Only ever asked about a value the gate itself produced — a probe, or a
 * declared enum member — so the question is "which arm would admit this", not a
 * general type test. The string family (`color` / `date` / `code` / `file`)
 * collapses to `string` because `armAccepts` makes no distinction between them
 * either: all five admit exactly `typeof value === 'string'`.
 */
function coarseKindOf(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

/**
 * Is this rejection about the VALUE'S KIND at the node itself, rather than
 * about its CONTENT?
 *
 * `issues` are RELATIVE to the node under judgement — which is why the union
 * recursion below is not a formality. A union's per-branch issues come back
 * with paths relative to the union node (measured: `page:card.title` refused a
 * number as `invalid_union` at `["title"]`, its two branch issues at `[]`), so
 * a judge that kept matching them against the absolute key path would find
 * nothing to refute and pass EVERY union key — including objectui#4971's own
 * `page:card.title` measurement, the one reading this gate exists to turn red.
 *
 *  - an issue DEEPER than the node means the kind was accepted and the content
 *    judged (a missing required member, a bad element) — not a kind refusal;
 *  - `invalid_type` at the node is the kind refusal itself;
 *  - `invalid_union` at the node is one only if EVERY branch refuses the kind;
 *  - `invalid_value` at the node — a closed list of literals — is decided by
 *    the list: a probe of a kind NO listed value has is refused for its kind,
 *    while one that shares a kind with some listed value is refused for its
 *    VALUE. Both halves are load-bearing and were measured on
 *    `record:quick_actions.variant`, a spec enum of strings: `'Account'` must
 *    read as a value refusal (or the block's correct `'string'` arm reads as
 *    invented — the false red triage flagged), and `42` must read as a KIND
 *    refusal (or a `'number'` arm on an enum contract would be exactly the
 *    silent widening this gate exists for, waved through by the same rule that
 *    protects the string arm). One key, both directions, so the two cannot be
 *    collapsed into one answer;
 *  - anything else at the node (`too_small`, `invalid_format`, a custom
 *    refinement) is a VALUE refusal, and the coarse-kind ceiling
 *    (`ComponentInput.type`, maintainer 2026-08-17) puts it outside what an arm
 *    claims — UNLESS an `invalid_type` sits beside it, which is the next
 *    paragraph.
 *
 * ## WHY `invalid_type` IS DECISIVE AND NOT JUST ANOTHER `every` MEMBER
 *
 * The two rules are not the same statement, and objectui#8204 is the difference.
 * A node can carry a kind refusal AND a content complaint at once, because Zod
 * keeps running a schema's checks after its type check has already failed: for
 * `z.string().min(1)` the probe `[]` comes back as BOTH `invalid_type`
 * (expected string) AND `too_small` (`[].length` is 0), at the same node, in
 * that order. Read by `every` alone that pair is a CONTENT refusal — one member
 * of the pair is not a kind code — and the value it describes is an array that
 * the contract refused for being an array.
 *
 * `some(invalid_type)` first is the fix, and it is a statement about the
 * contract rather than about Zod: `invalid_type` at a node says the value is not
 * of that node's type, and a value cannot be simultaneously the right kind and
 * the wrong one. Whatever else the node says about a value it has already
 * refused for its kind is downstream of that refusal, not a second opinion
 * competing with it. (`too_small` on a non-string is exactly such an artefact:
 * "too short" is not a claim anyone would make about `[]` against a string
 * contract.)
 *
 * MEASURED on the installed `@objectstack/spec` 17.3.0 artifact, on the union
 * this card was filed for — `record:activity.types`,
 * `z.array(z.union([FeedItemType, z.string().min(1)]))`. Two array probes, one
 * key, opposite readings under the old rule, and the ONLY difference between
 * them is the artefact issue:
 *
 *     probe `[]`          branch 2 issues -> [invalid_type, too_small] -> every() false
 *     probe `['Account']` branch 2 issues -> [invalid_type]            -> every() true
 *
 * so `[]` alone put `array` into the accepted kind set of a key whose array
 * members the contract measurably refuses, and the derivation gate read
 * `contract accepts {string,array}`. The union recursion below was NEVER the
 * missing piece — it runs, and it is what carries the branch verdicts up — the
 * per-branch reading underneath it was wrong.
 */
function refusesKind(issues: readonly SpecIssue[], probed: unknown): boolean {
  const here = issues.filter((issue) => (issue.path ?? []).length === 0);
  if (issues.length > here.length) return false;
  if (here.length === 0) return false;
  // Decisive, and therefore ahead of the `every` — see the paragraph above. It
  // also makes an `invalid_type` arm of that `every` unreachable, which is why
  // there no longer is one.
  if (here.some((issue) => issue.code === 'invalid_type')) return true;
  return here.every(
    (issue) =>
      (issue.code === 'invalid_value' &&
        Array.isArray(issue.values) &&
        issue.values.length > 0 &&
        !issue.values.some((allowed) => coarseKindOf(allowed) === coarseKindOf(probed))) ||
      (issue.code === 'invalid_union' &&
        (issue.errors ?? []).length > 0 &&
        (issue.errors ?? []).every((branch) => refusesKind(branch, probed))),
  );
}

type ArmVerdict = 'accepts' | 'refuses-content' | 'refuses-kind' | 'no-schema';

/**
 * What the contract says about ONE value on ONE key — scoped to that key.
 *
 * Scoped is the load-bearing word. A whole-parse boolean cannot answer this
 * question on any block with a REQUIRED key: `{ filter: {} }` fails
 * `element:number`'s schema for the missing `object` / `aggregate`, and reading
 * that as a verdict on `filter` would report every arm of every key on such a
 * block as invented. So only issues about this key count, and a parse whose
 * every complaint is about a sibling reads as `accepts`.
 */
function specArmVerdict(type: string, key: string, value: unknown): ArmVerdict {
  const parser = specParser(type);
  if (!parser) return 'no-schema';
  const result = parser.safeParse({ [key]: value });
  if (result.success) return 'accepts';
  const issues = result.error?.issues ?? [];
  // The key refused BY NAME — strict-mode contracts report it this way, at the
  // parent with the offending names in `keys`. Defensive: the walk below only
  // judges keys the accepted set already carries.
  if (issues.some((issue) => issue.code === 'unrecognized_keys' && (issue.keys ?? []).includes(key)))
    return 'refuses-kind';
  const mine = issues
    .filter((issue) => (issue.path ?? [])[0] === key)
    .map((issue) => ({ ...issue, path: (issue.path ?? []).slice(1) }));
  if (mine.length === 0) return 'accepts';
  return refusesKind(mine, value) ? 'refuses-kind' : 'refuses-content';
}

/**
 * The values an `enum` arm admits, flattened from either declaration form.
 *
 * The same flattening `enumValues` does in `packages/sdui-parser/src/validate.ts`
 * — that function is module-private, and the two forms (`['a', 'b']` or
 * `[{ label, value }]`) are `ComponentInput.enum`'s own published shape rather
 * than a judgement, so this is a re-read of a data shape, not a second
 * classifier.
 */
function declaredEnumValues(input: ComponentInput): unknown[] {
  return (input.enum ?? []).map((entry) =>
    typeof entry === 'object' && entry !== null ? (entry as { value: unknown }).value : entry,
  );
}

interface ArmJudgement {
  /** `BLOCK.INPUT:ARM` — the exemption key format. */
  id: string;
  type: string;
  input: string;
  arm: string;
  verdict: 'witnessed' | 'refused' | 'exempt-slot' | 'exempt-empty-enum';
  /** What the contract actually answered, for the failure message. */
  evidence: string;
}

/**
 * Judge every arm of every declared input on one block.
 *
 * Inputs whose NAME the contract does not accept are skipped, not judged: they
 * are the FORWARD direction's subject (and its exemption list's), and asking
 * what kind a contract accepts on a key it does not declare has no answer worth
 * reporting. Today that set is empty — `no covered block declares an off-spec
 * input` is what the forward direction asserts — so the skip removes nothing.
 */
function judgeArms(type: string): ArmJudgement[] {
  const accepted = new Set(specTopLevelKeys(type));
  const judgements: ArmJudgement[] = [];
  for (const input of declaredInputEntries(type) ?? []) {
    if (!accepted.has(input.name)) continue;
    for (const arm of inputTypeArms(input.type)) {
      const id = `${type}.${input.name}:${arm}`;
      if (ARM_KINDS_WITHOUT_A_VALUE_CLAIM.has(arm)) {
        judgements.push({ id, type, input: input.name, arm, verdict: 'exempt-slot', evidence: 'describes a child position, not a value' });
        continue;
      }
      if (arm === 'enum') {
        // EXACT, not coarse: `armAccepts` admits precisely the declared members,
        // so every one of them must be a value the contract accepts. This is
        // where an enum arm is judged — the coarse rule never sees it.
        const members = declaredEnumValues(input);
        if (members.length === 0) {
          judgements.push({ id, type, input: input.name, arm, verdict: 'exempt-empty-enum', evidence: 'declares no members, so it admits nothing' });
          continue;
        }
        const refused = members.filter(
          (member) => specArmVerdict(type, input.name, member) !== 'accepts',
        );
        judgements.push({
          id,
          type,
          input: input.name,
          arm,
          verdict: refused.length === 0 ? 'witnessed' : 'refused',
          evidence:
            refused.length === 0
              ? `all ${members.length} declared members accepted`
              : `the contract refuses the declared member(s) ${JSON.stringify(refused)}`,
        });
        continue;
      }
      const probes = COARSE_ARM_PROBES[arm] ?? [];
      const verdicts = probes.map((probe) => specArmVerdict(type, input.name, probe));
      const witnessed = verdicts.some((verdict) => verdict === 'accepts' || verdict === 'refuses-content');
      judgements.push({
        id,
        type,
        input: input.name,
        arm,
        verdict: witnessed ? 'witnessed' : 'refused',
        evidence: witnessed
          ? `probe verdicts ${JSON.stringify(verdicts)}`
          : `the contract refuses the KIND itself — probe verdicts ${JSON.stringify(verdicts)}`,
      });
    }
  }
  return judgements;
}

/** Every arm judgement this gate makes, computed once. */
const ARM_JUDGEMENTS: ArmJudgement[] = covered.flatMap(judgeArms);

/** Arms of `type` the contract refuses outright, as `BLOCK.INPUT:ARM`. */
const refusedArms = (type: string): string[] =>
  ARM_JUDGEMENTS.filter((judgement) => judgement.type === type && judgement.verdict === 'refused').map(
    (judgement) => judgement.id,
  );

/**
 * Declared arms the contract refuses, ACCEPTED for now, each with the reason.
 * Key format: `BLOCK.INPUT:ARM`.
 *
 * Third instance of this file's one exemption discipline, and the bar is the
 * same as `OFF_SPEC_EXEMPTIONS`': the divergence has to be owned by a named,
 * open piece of work, because neither `@objectstack/spec` nor a declaration is
 * edited to make a gate green (AGENTS.md #0 / #0.1). Every reason cites an
 * issue, which `every arm exemption states a reason and references a tracking
 * issue` asserts, and an entry that stops describing anything is DELETED by
 * `carries no stale arm exemption`.
 *
 * BOTH ENTRIES ARE RED-ON-ARRIVAL FINDINGS, not regressions this change
 * introduced. objectui#4971 was filed believing there were ZERO fake arms —
 * true of what it had measured, which was #3832's five multi-arm specimens,
 * each checked against spec and its renderer. These two are SINGLE-arm
 * declarations, the form that predates #3832's array `type` entirely, and
 * nothing had ever compared one to the contract. Finding them on arrival is the
 * gate working, and the dispatched scope of #4971 is explicit that a red on
 * arrival gets REPORTED rather than declared away by editing the declaration.
 */
const OFF_SPEC_ARM_EXEMPTIONS: Record<string, string> = {
  /*
   * EMPTY, AND THAT IS THE RESULT — both entries were harvested at
   * `@objectstack/spec` 17.3.0, each resolved upstream in the direction its own
   * reason named. Measured with this gate's own coarse probes against the
   * installed artifact:
   *
   *   - `element:number.filter:array` (objectui#6206) — the spec entry was a
   *     record and refused an array outright; 17.3.0 accepts `[]` and answers
   *     `invalid_type` at `filter.0` for `['Account']`. So the ARRAY KIND is
   *     accepted and only the content is judged, which is the first of the two
   *     resolutions the reason offered: "widening the spec entry to the
   *     ViewFilterRule array form every sibling filter uses". The declaration
   *     was right; the contract moved to it.
   *   - `object-grid.data:object` (objectui#6207) — the two spec authorities
   *     that disagreed have converged. `ComponentPropsMap[object-grid].data`
   *     was `z.array(z.unknown())`; it now answers `invalid_union` at
   *     `data.provider` for an object probe, i.e. the discriminated
   *     `ViewDataSchema` shape `ObjectGridSchema.data` already resolved to.
   *     That is exactly the "convergence is upstream" the entry was waiting on,
   *     and the `object` arm objectui#5090 / PR objectui#5108 deliberately
   *     chose is now the contract's own.
   *
   * ⛔ Neither was closed by editing a declaration — both declarations are
   * byte-identical to what they were; the contract changed underneath them.
   * `carries no stale arm exemption` is what forced the deletion, which is this
   * file's exemption discipline working end to end. objectui#6206 and #6207 can
   * be closed as resolved-upstream; reported on objectui#7122.
   */

  /*
   * ⚠️ 17.5.0 BOOKINGS — objectui#11111 decision 3 = B (record 5902351047).
   * Arms the contract refuses on blocks 17.5.0 newly judges, plus
   * `object-form.layout`, whose spec row narrowed to two members. Booked to
   * objectui#11168, which narrows each declaration to what the spec accepts;
   * capped at the entries listed, and that card's landing empties the map.
   *
   * objectui#11168 slice 1 took the three `action:*` entries by NARROWING the
   * declarations: `action:group.actions` and `action:menu.actions` are now a
   * list of objects (`type: 'array'`, `of: 'object'`, the shape both renderers
   * read), and `action:group.size` publishes the Button primitive's four sizes
   * without the refused `md`.
   *
   * objectui#11168 slice 2 took `element:definition-list.columns:enum` the same
   * way: the enum's members are now the NUMBERS `1` and `2`, which the spec row
   * declares and the renderer compares (`props.columns === 2`); the strings it
   * declared before drew one column. The pin is
   * `packages/components/src/renderers/basic/__tests__/element-list-inputs-11168.test.tsx`.
   *
   * objectui#11168 slice 3 took the last entry, `object-form.layout:enum`, the
   * same way, and with it objectui#7759 group C: the enum is `vertical` /
   * `horizontal`, the two the spec row declares. Measured through the real
   * `SchemaRenderer`, `inline` and `grid` rendered byte-identical to
   * `vertical`, so nothing that rendered is lost. The pin is
   * `packages/plugin-form/src/__tests__/objectFormLayout-11168.test.tsx`.
   * The map is EMPTY again.
   */
};

// ── the MEMBER direction (objectui#8067) ─────────────────────────────────────
//
// The first of the two LIMITs in this file's header, closed. `ComponentInput`
// now carries `of` — the coarse KIND of an input's members, array elements or
// the values of an object used as a map — so the `inputs` side can finally say
// what a container holds, and this section compares it to what the contract
// holds. Same `covered` set, same derived-not-restated expectations, same
// exemption discipline as the three directions above, and the same ONE
// DIRECTION for the same reason: a member kind the contract REFUSES is silent
// (the manifest, the generated `.d.ts` and `validateTree` all publish it as
// legal), while declaring FEWER member kinds than the contract accepts is
// merely noisy, and noise is audible.
//
// WHAT THIS COST BEFORE IT EXISTED. `page:header.actions` — spec
// `z.array(z.string())`, "Action IDs"; the renderer read the members as
// `ActionDef` OBJECTS; this gate saw `actions` on both sides and stayed green
// for the whole life of the drift. What settled it was a maintainer ruling, not
// a test, and even after the fix the fact "these are ids" lived only in the
// registration's `description` PROSE. It is now `of: 'string'` at that
// registration, and the calibration pin below asserts, by name, that this gate
// reds on `of: 'object'` there — the exact declaration the drift would have
// made.

/**
 * The container arms a member declaration can describe.
 *
 * `of` means the same thing on each: the ELEMENTS of the array, and the VALUES
 * of an object used as a MAP. An input declaring `of` and neither of these has
 * no member position at all, which `judgeMembers` reports rather than skips.
 */
const CONTAINER_ARMS = new Set(['array', 'object']);

/**
 * The key a member probe occupies when the container arm is `object`.
 *
 * Deliberately a name no contract declares, because the two answers it can draw
 * are exactly the two cases that need telling apart: a MAP contract
 * (`z.record(...)`) judges the value under whatever key it is given, while a
 * NAMED-SHAPE contract (`z.object({ ... })`) refuses the key itself at the
 * container node — which is not a verdict about the member kind, it is the
 * absence of a uniform member position.
 */
const OBJECT_MEMBER_PROBE_KEY = '__objectui_member_probe__';

/** The value that puts one member probe in the member position of a container arm. */
function containerProbe(containerArm: string, member: unknown): { value: unknown; position: unknown } {
  return containerArm === 'array'
    ? { value: [member], position: 0 }
    : { value: { [OBJECT_MEMBER_PROBE_KEY]: member }, position: OBJECT_MEMBER_PROBE_KEY };
}

type MemberVerdict = ArmVerdict | 'no-member-position';

/**
 * What the contract says about ONE member value, in ONE container arm, on ONE
 * key.
 *
 * The same scoping discipline `specArmVerdict` is built on, one level deeper:
 * only issues about this key count, and of those only the ones at the MEMBER's
 * own position, so a sibling key's missing requirement cannot speak for a
 * member and a complaint about the container cannot either. Once the issues are
 * rebased onto the member node, the judgement is `refusesKind` — the same
 * function, unchanged, because "is this a KIND refusal or a CONTENT refusal" is
 * the same question at any depth.
 *
 * `no-member-position` is the verdict this level adds, and it is not a shrug:
 * it means the contract refused the CONTAINER — either its kind outright, or,
 * for an `object` arm, the probe key itself, which is how a named-shape
 * `z.object({ ... })` says it is not a map. A declaration claiming uniform
 * members of a contract that has no uniform member position is wrong in a way
 * worth naming, so the gate below treats it as a refusal rather than skipping
 * it.
 */
function specMemberVerdict(
  type: string,
  key: string,
  containerArm: string,
  member: unknown,
): MemberVerdict {
  const parser = specParser(type);
  if (!parser) return 'no-schema';
  const { value, position } = containerProbe(containerArm, member);
  const result = parser.safeParse({ [key]: value });
  if (result.success) return 'accepts';
  const issues = result.error?.issues ?? [];
  // The key refused BY NAME at the top — the forward direction's subject, and
  // `judgeMembers` only judges keys the accepted set already carries.
  if (issues.some((issue) => issue.code === 'unrecognized_keys' && (issue.keys ?? []).includes(key)))
    return 'no-member-position';
  const mine = issues.filter((issue) => (issue.path ?? [])[0] === key);
  if (mine.length === 0) return 'accepts';
  // Anything AT the container node is about the container, not the member: an
  // `invalid_type` refusing the container kind, or the `unrecognized_keys` a
  // named-shape object raises for the probe key.
  if (mine.some((issue) => (issue.path ?? []).length === 1)) return 'no-member-position';
  const atMember = mine
    .filter((issue) => (issue.path ?? [])[1] === position)
    .map((issue) => ({ ...issue, path: (issue.path ?? []).slice(2) }));
  if (atMember.length === 0) return 'accepts';
  return refusesKind(atMember, member) ? 'refuses-kind' : 'refuses-content';
}

interface MemberJudgement {
  /** `BLOCK.INPUT:of=ARM` — the exemption key format. */
  id: string;
  type: string;
  input: string;
  arm: string;
  verdict: 'witnessed' | 'refused' | 'exempt-slot' | 'exempt-empty-enum' | 'no-container-arm';
  /** What the contract actually answered, for the failure message. */
  evidence: string;
}

/**
 * Judge every declared member arm of every declared input on one block.
 *
 * An input that declares no `of` produces no judgement — this direction asks
 * what a DECLARATION claims, and there is nothing to compare against a key that
 * claims nothing. (What that silence costs is the LIMIT this section closes;
 * which keys deserve a declaration and which are left to per-block discipline
 * is recorded on `ComponentInput.of` and pinned by
 * `member declarations are derived from single-kind member contracts` below.)
 *
 * Off-spec input names are skipped for the same reason `judgeArms` skips them:
 * asking what members a contract accepts inside a key it does not declare has
 * no answer worth reporting.
 */
function judgeMembers(type: string): MemberJudgement[] {
  const accepted = new Set(specTopLevelKeys(type));
  const judgements: MemberJudgement[] = [];
  for (const input of declaredInputEntries(type) ?? []) {
    if (!accepted.has(input.name)) continue;
    const memberArms = inputTypeArms(input.of as never);
    if (memberArms.length === 0) continue;
    const containerArms = inputTypeArms(input.type).filter((arm) => CONTAINER_ARMS.has(arm));
    for (const arm of memberArms) {
      const id = `${type}.${input.name}:of=${arm}`;
      if (containerArms.length === 0) {
        judgements.push({
          id, type, input: input.name, arm,
          verdict: 'no-container-arm',
          evidence: `declares members but its type is ${JSON.stringify(input.type)}, which holds none`,
        });
        continue;
      }
      if (ARM_KINDS_WITHOUT_A_VALUE_CLAIM.has(arm)) {
        judgements.push({
          id, type, input: input.name, arm,
          verdict: 'exempt-slot',
          evidence: 'describes a child position, not a value',
        });
        continue;
      }
      if (arm === 'enum') {
        // EXACT, not coarse — the same rule the `enum` ARM is judged by, since
        // an enum's admitted set is finite and written down. Every declared
        // member must be a value the contract accepts SOMEWHERE in the member
        // position of some declared container arm.
        const members = declaredEnumValues(input);
        if (members.length === 0) {
          judgements.push({
            id, type, input: input.name, arm,
            verdict: 'exempt-empty-enum',
            evidence: 'declares no members, so it admits nothing',
          });
          continue;
        }
        const refused = members.filter((member) =>
          !containerArms.some(
            (containerArm) => specMemberVerdict(type, input.name, containerArm, member) === 'accepts',
          ),
        );
        judgements.push({
          id, type, input: input.name, arm,
          verdict: refused.length === 0 ? 'witnessed' : 'refused',
          evidence:
            refused.length === 0
              ? `all ${members.length} declared members accepted`
              : `the contract refuses the declared member(s) ${JSON.stringify(refused)}`,
        });
        continue;
      }
      const probes = COARSE_ARM_PROBES[arm] ?? [];
      const verdicts = containerArms.flatMap((containerArm) =>
        probes.map((probe) => specMemberVerdict(type, input.name, containerArm, probe)),
      );
      const witnessed = verdicts.some(
        (verdict) => verdict === 'accepts' || verdict === 'refuses-content',
      );
      judgements.push({
        id, type, input: input.name, arm,
        verdict: witnessed ? 'witnessed' : 'refused',
        evidence: witnessed
          ? `member probe verdicts ${JSON.stringify(verdicts)}`
          : `the contract admits no member of this KIND — member probe verdicts ${JSON.stringify(verdicts)}`,
      });
    }
  }
  return judgements;
}

/** Every member judgement this gate makes, computed once. */
const MEMBER_JUDGEMENTS: MemberJudgement[] = covered.flatMap(judgeMembers);

/** The verdicts that mean "the contract will not have this member declaration". */
const MEMBER_REFUSALS = new Set(['refused', 'no-container-arm']);

/** Member arms of `type` the contract refuses, as `BLOCK.INPUT:of=ARM`. */
const refusedMembers = (type: string): string[] =>
  MEMBER_JUDGEMENTS.filter(
    (judgement) => judgement.type === type && MEMBER_REFUSALS.has(judgement.verdict),
  ).map((judgement) => judgement.id);

/**
 * Declared MEMBER arms the contract refuses, ACCEPTED for now, each with the
 * reason. Key format: `BLOCK.INPUT:of=ARM`.
 *
 * Fourth instance of this file's one exemption discipline, and the bar is
 * unchanged: the divergence has to be owned by a named, open piece of work,
 * because neither `@objectstack/spec` nor a declaration is edited to make a
 * gate green (AGENTS.md #0 / #0.1).
 *
 * EMPTY ON ARRIVAL, and that is a measurement rather than an accident. Every
 * `of` this repository declares was DERIVED from the contract — each container
 * key's member position was probed with one value of each coarse kind, and a
 * declaration was written only where exactly ONE kind was accepted — so a
 * refusal here would mean the derivation and the contract disagree, which is a
 * finding, not an exemption.
 */
const OFF_SPEC_MEMBER_EXEMPTIONS: Record<string, string> = {};

/**
 * Container keys whose member contract accepts MORE THAN ONE coarse kind, and
 * are therefore deliberately left without an `of`.
 *
 * Pinned rather than merely absent, because "no declaration" and "no
 * declaration for a reason" are the same byte in the registration and opposite
 * facts about this gate. Declaring one arm of a genuine member union is the
 * NARROWING this repo leaves un-gated as noise (#4971), and declaring all of
 * them would advertise member shapes the renderer may not resolve — the rule
 * `ComponentInput.type` states for arms, one level down. Either way it is
 * per-block knowledge, not a repo-wide derivation, so it stays out of this
 * change.
 */
const MULTI_KIND_MEMBER_CONTRACTS: Record<string, string> = {
  'record:highlights.fields':
    'The member contract is a union — a field NAME or an inline field object — so no single coarse arm describes it and declaring both would advertise a member shape only the per-block pin next to the renderer can vouch for (packages/plugin-detail/src/__tests__/recordHighlightsInputs.spec-parity.test.ts). objectui#8067 leaves it undeclared on purpose.',
  'element:repeater.fields':
    'The member contract is a union — a bare field NAME or `{ field }` — so no single coarse arm describes it; what the renderer prints for each arm is pinned next to it (packages/components/src/renderers/basic/__tests__/element-list-inputs-11168.test.tsx). objectui#11168 slice 2 leaves it undeclared on purpose.',
};

// ── the MEMBER-PIN direction (objectui#8068) ─────────────────────────────────
//
// The four directions above judge a block's DECLARATION — which top-level keys
// it publishes, with which coarse kinds, and (since objectui#8067 landed
// alongside this one) with which coarse kind INSIDE a container. None of them
// can see the member's own KEYS, and the LIMIT note at the top of this file says
// so in as many words: `of` "stops at the KIND … `of: 'object'` says the members
// are objects, never WHICH KEYS they have", so a drifted key INSIDE an array
// element or a nested object is still invisible here.
//
// ⚠️ That merge changed a NUMBER in this paragraph and nothing else in this
// direction. `of` is a DECLARATION, not a pin, so it neither satisfies nor
// exempts anything below: the population this direction judges, its ledger and
// its ceiling are the same on the merged tree as they were on the branch that
// measured them.
//
// That note then names the mitigation — `record:details.sections`,
// `record:highlights.fields` and `record:related_list.add` "publish their
// members in prose and are pinned by per-block tests next to their renderers".
// All three pins are real. What was NOT real is any requirement that a fourth
// key get one.
//
// `page:header.actions` is that fourth key, and it is the measurement this
// direction exists for. Array-typed, member shape in `description` prose only
// (`packages/components/src/renderers/layout/containers.tsx`), spec
// `z.array(z.string())` — action IDs — while the renderer read the members as
// `ActionDef` OBJECTS and resolved nothing, so metadata satisfying the published
// contract rendered ZERO buttons. Every layer was green: the key names are in
// parity (forward and reverse), the `'array'` arm is a kind the contract accepts
// (the arm direction), and no per-block test existed to look inside. It took a
// human filing objectstack#11592 and a maintainer ruling (2026-08-25) to settle
// it, and `packages/components/src/__tests__/page-header-action-ids.test.tsx` —
// the fourth pin — arrived as part of that FIX (objectui#6252), not because
// anything demanded it.
//
// Three keys got it right, the fourth did not, and nothing noticed the fourth.
// So the discipline stops being voluntary here: every array/object-armed input
// on a covered block must name a pin, or carry an exemption.
//
// ## WHAT THIS DIRECTION CAN AND CANNOT JUDGE
//
// The criterion objectui#8068 sets is a JUDGEMENT, not a computation: a pin must
// constrain the shape the renderer actually READS, rather than restate the
// registration. A registration saying `of: 'string'` while the code reads
// members as objects is the exact hole, and no mechanical reader can tell the
// two apart — the four exemplars do it four different ways (a description
// derived from the spec's element schema, a spec-vs-declaration arm set, a
// renderer-default comparison, and a twice-authored render equivalence).
//
// So this direction is built the way every exemption in this file is: the
// judgement is made in a diff someone reviews, and what is MECHANISED is the
// part that rots silently. A registered pin must
//
//   1. exist on disk — a deleted or renamed pin file is the failure mode that
//      leaves the key uncovered while the registry entry still reads deliberate;
//   2. be a file the test runner collects, so "pinned" means "executed";
//   3. NAME the block and NAME the key, so an entry cannot point at a file that
//      says nothing about this key. That is the locator, and it is why the
//      calibration below asserts it discriminates: a check that matched any file
//      would license every entry at once.
//
// ## THE POPULATION, MEASURED FIRST — 58 of 77 (objectui#8071)
//
// objectui#8068 required the number before the gate, because the number chooses
// the route: single digits means add the pins and let the gate bite, dozens
// means a transition. Measured on this branch, over this file's own `covered`
// set: 77 array/object-armed inputs across 22 blocks, of which 19 already have a
// pin that meets both the criterion and the locator. 58 do not.
//
// ⚠️ THAT CENSUS WAS TAKEN OVER AN INCOMPLETE POPULATION — objectui#8176. Two
// spec-carried blocks were missing from `covered` because `getConfig` is
// loaded-only and the console registers plugin blocks with `registerLazy`, so
// 77/22/58 was never the whole tree. Re-measured over the corrected population:
// 81 array/object-armed inputs across 24 blocks, 19 pinned, 62 not. The four
// that moved are `object-calendar.calendar` / `.dataSource` and
// `object-kanban.columns` / `.dataSource` — pre-existing declarations, named in
// `NEWLY_JUDGED_UNPINNED_MEMBERS`, and the reason objectui#8176 RAISED
// `MEMBER_PIN_EXEMPTION_CEILING` — the one raise this constant has had.
// ⚠️ That is a DATED reading of the ceiling, not a live one, and it is written
// that way on purpose: the constant ratchets DOWN under every later slice, so
// a number copied into this paragraph would be true on the day it was written
// and false at the next slice. Its live value is the declaration itself.
// objectui#8071's work is unchanged in kind and four keys longer in extent.
//
// ⚠️ THE POPULATION THEN GREW BY TWO, and they were answered with PINS rather
// than with room. objectui#8186 landed objectui#7712's declaration while this
// branch was open, so `object-calendar.filter` and `object-kanban.filter`
// became array-armed inputs on newly judged blocks — exactly the case this
// ceiling exists to refuse absorbing. Both are in `MEMBER_PINS` below: the
// calendar's is the file objectui#7711 already left behind, the kanban's was
// written for this change. 83 array/object-armed inputs across 24 blocks, 21
// pinned, 62 not — and the ceiling does NOT move. A genuinely new array key
// gets a pin, which is the whole rule, now demonstrated rather than only
// asserted.
//
// ⚠️ AND THEN BY FOUR MORE, answered the same way. objectui#8313 declared
// `object-kanban`'s `data`, `cardFields`, `grouping` and
// `conditionalFormatting` — the array/object-armed half of the backlog
// objectui#8201 left behind — so all four entered this population at once. All
// four got PINS. Measured over the ledger this file carries, before and after:
// 84 array/object-armed inputs, 22 pinned, 62 not -> 88, 26 pinned, 62 not. The
// exemption list is byte-identical and the ceiling is still 62, which is the
// demonstration the paragraph above claims: FOUR new array keys at once could
// not be absorbed by room, because there is none to absorb them with.
//
// ⚠️ AND THE TRANSITION HAS STARTED SPENDING ITSELF DOWN. objectui#8071's
// first slice converted FOUR keys from exemption to pin — `object-form.fields`,
// `object-grid.exportOptions`, `object-grid.bulkActions` and
// `object-grid.bulkActionDefs` — the four the card singled out because a
// near-miss contract test already existed for each. Measured over this file's
// own ledger, before and after: 90 array/object-armed inputs, 28 pinned, 62
// exempt -> 90, 32 pinned, 58 exempt. The population does not move (a pin and
// an exemption are the two halves of one partition), and
// `MEMBER_PIN_EXEMPTION_CEILING` moves WITH the list, 62 -> 58 — see its own
// docblock for why a ceiling that does not follow the count down is a budget
// rather than a ratchet.
//
// ⛔ What those near-miss tests were NOT. Two of the three the card named cover
// a NEIGHBOURING key rather than the one they were credited with.
// `sectionFields.spec-parity.test.ts` pins `sections[].fields`, whose member is
// the spec `FormFieldSchema` object keyed on `field`, while the top-level
// `object-form.fields` reads BARE NAMES and drops that very object in silence;
// `bulk-action-spec-parity.test.ts` pins the `BulkActionDef` TYPE against the
// spec and never touches either key's member read. So three of these four pins
// are new behavioural files rather than one added assertion, and the fourth
// (`exportOptions`) grew a third direction on an existing scanner. The locator
// would have accepted the first file on its STRINGS alone — it already contains
// both `object-form` and `fields` — which is the concrete reason `MEMBER_PINS`
// is reviewed rather than computed.
//
// ⚠️ SECOND SLICE, AND THE FIRST ONE TAKEN A BLOCK AT A TIME. objectui#8071's
// second slice converted four keys on ONE block — `record:related_list`'s
// `columns`, `dataSource`, `filter` and `sort` — chosen for a coherent file
// surface rather than for near-miss tests: one renderer
// (`renderers/record-related-list.tsx` over `RelatedList.tsx`) and one existing
// spec-parity file. Measured over this file's own ledger, before and after: 90
// array/object-armed inputs, 32 pinned, 58 exempt -> 90, 36 pinned, 54 exempt,
// and `MEMBER_PIN_EXEMPTION_CEILING` follows 58 -> 54 in the same commit.
//
// ⭐ Two of the four were PROMOTED pre-existing files, and slice 1's trap is the
// reason that sentence needs the qualifier. `RelatedList.listFilter.test.tsx`
// and `RecordRelatedListRenderer.elementDataSource.test.tsx` were read end to
// end before being credited, and they really do pin the member shape their key
// names. The second one ALSO names `columns` and `sort` — it asserts a saved
// view's `columns`/`sort` reach the list — so the locator would have accepted it
// for those two keys as well, on its strings, while pinning nothing about what
// an authored member of either key IS. Those two got new behavioural files
// instead. That is `sectionFields.spec-parity.test.ts` one slice on, in the same
// file the correct credit came from.
//
// ⛔ AND THE BLOCK IS NOT EMPTY. `record:related_list.actions` stays exempt on a
// reason of its own: nothing reads it. The registration declares it
// (`of: 'string'`, "Action IDs available for related records"), the SPEC
// declares it (`RecordRelatedListProps.actions`), and the renderer never touches
// `schema.actions` — the row and toolbar actions it draws come from the host
// bridge `useRelatedRecordActions()`. A member pin constrains what the RENDERER
// READS, so there is nothing here to constrain; the honest pin available is "the
// key is dead", which is a statement that the contract is wrong rather than a
// member shape, and fixing it is an ADR-0049 enforce-or-remove decision the spec
// owns. See `NO_READ_SITE_TO_PIN`.
//
// ⭐ objectui#11163 CLOSED IT, in the direction the spec's owner chose: the
// maintainer ruled ENFORCE on objectstack-ai/objectstack#20665, the renderer
// reads `schema.actions`, and the key's member pin is registered above.
// `NO_READ_SITE_TO_PIN` was deleted with its one entry.
//
// ⭐ THIRD SLICE, AND THE FIRST BLOCK LEFT WITH NO EXEMPTIONS AT ALL.
// objectui#8071's third slice converted the four remaining keys of
// `element:record_picker` — `dataSource`, `label`, `placeholder` and `sort` —
// the batch this card's own dispatch names as the example of "one block
// family". Unlike `record:related_list`, nothing here needed a
// `NO_READ_SITE_TO_PIN`: every declared key on this block has a real read site,
// so the block drops out of `MEMBER_PIN_EXEMPTIONS` entirely rather than
// leaving one entry behind. Measured over this file's own ledger, before and
// after: 90 array/object-armed inputs, 36 pinned, 54 exempt -> 90, 40 pinned,
// 50 exempt, and `MEMBER_PIN_EXEMPTION_CEILING` follows 54 -> 50 in the same
// commit. Two of the four pins PROMOTE pre-existing files (`dataSource`, and
// one file covering both `label` and `placeholder`), read end to end first;
// `sort` — the standalone `properties.sort` key, as opposed to the
// `dataSource.sort` sub-member the promoted `dataSource` file already
// exercised — had no existing candidate anywhere in the repo, so it is a new
// file. See `MEMBER_PIN_EXEMPTION_CEILING`'s own docblock for the accounting.
//
// ⭐ FOURTH SLICE, THE SECOND WHOLE BLOCK CLOSED, AND A TWO-KEY FAMILY.
// objectui#8071's fourth slice converted both remaining keys of ONE block —
// `record:quick_actions`'s `actionNames` and `requiredPermissions` — chosen
// because the block's remaining population is small enough to close outright
// (the shape this card's own dispatch names, over an arbitrary four). Neither
// key needed `NO_READ_SITE_TO_PIN`: `actionNames` drives a real
// `useMetadataItem` lookup against the object's own `actions`, and
// `requiredPermissions` is a block-level gate that puts an
// insufficient-permissions notice in place of the whole bar before any action
// is drawn. It reads the capability set (`perms.hasCapabilities(required)`)
// since objectui#10058; slice 4 found it reading `perms.can(objectName, p)`
// (sentence corrected by objectui#10224). It is a DIFFERENT mechanism from an
// `ActionDef`'s own per-action field of the same name, which a pre-existing
// fixture already exercised without touching this key at all. Measured over
// this file's own ledger, before and
// after: 90 array/object-armed inputs, 40 pinned, 50 exempt -> 90, 42 pinned,
// 48 exempt, and `MEMBER_PIN_EXEMPTION_CEILING` follows 50 -> 48 in the same
// commit. One of the two pins PROMOTES a pre-existing file
// (`recordQuickActionsInputs.actionNamesFallback.test.tsx`); the other
// (`requiredPermissions`) is new, for the reason above.
//
// A list this size is the transition case, and this file already owns the
// pattern for it —
// `OFF_SPEC_EXEMPTIONS` / `UNPUBLISHED_EXEMPTIONS` / `OFF_SPEC_ARM_EXEMPTIONS`
// are explicit, reasoned, issue-backed, and go RED once stale. This is the same
// mechanism, not a second one: `MEMBER_PIN_EXEMPTIONS` below lists EVERY
// remaining key BY NAME — the list IS the census, so read it rather than any
// count written about it — every entry cites an issue, and an entry whose key
// acquires a pin is reported STALE and must be deleted in the same change. The
// list has a CEILING as well as a stale check, because the cheap way to green a
// new array key is to add ONE MORE entry rather than a pin; `the member-pin
// exemption list only ratchets DOWN` is the assertion that refuses it.
//
// ## WHAT IS DELIBERATELY NOT IN THE POPULATION, stated rather than dropped
//
// `covered` — this file's own set, spec-carried blocks that declare inputs — is
// the population, unchanged. The wider registration graph carries 310
// array/object-armed inputs across 501 registered type names (aliases included:
// `object-grid`, `plugin-grid:object-grid` and `view:grid` are three names for
// one registration), and 233 of those sit on blocks with no `ComponentPropsMap`
// entry. NO direction in this file has ever judged them — a member pin needs a
// published contract to compare a member shape against, and those blocks have
// none. That boundary is pre-existing rather than a narrowing taken here, and it
// is recorded in objectui#8071 so it cannot go quiet.

/** Coarse arms whose values have a MEMBER shape this file cannot see. */
const STRUCTURED_ARMS = new Set(['array', 'object']);

/** One declared input that carries a member shape, as this direction sees it. */
interface StructuredInput {
  /** `BLOCK.INPUT` — the registry/exemption key format used throughout. */
  id: string;
  type: string;
  input: string;
  arms: string[];
}

/**
 * Every array/object-armed input on a covered block — the population this
 * direction judges.
 *
 * Deliberately NOT filtered to keys the contract accepts, unlike `judgeArms`.
 * That filter is right there — an arm makes a claim ABOUT the contract, so a key
 * the contract does not declare has no arm question to answer — and wrong here:
 * a member shape is a claim about what the RENDERER reads, which an off-spec key
 * makes just as loudly. Today the two sets coincide (`no covered block declares
 * an off-spec input`), so the choice removes nothing and cannot hide anything;
 * it is stated because the day they diverge, the stricter reading is the one
 * this card asked for.
 */
const structuredInputs: StructuredInput[] = covered.flatMap((type) =>
  (declaredInputEntries(type) ?? [])
    .map((input) => ({
      id: `${type}.${input.name}`,
      type,
      input: input.name,
      arms: inputTypeArms(input.type),
    }))
    .filter((entry) => entry.arms.some((arm) => STRUCTURED_ARMS.has(arm))),
);

/** The array/object-armed inputs of one covered block. */
const structuredInputsOf = (type: string): StructuredInput[] =>
  structuredInputs.filter((entry) => entry.type === type);

/** A registered per-block member pin. */
interface MemberPin {
  /** Repo-relative path of the test file that pins this key's member shape. */
  file: string;
  /** WHAT it constrains — the half a reader needs and the locator cannot check. */
  pins: string;
}

/**
 * The member pins objectui#11168 slice 1 registered for the array/object-armed
 * keys `action:button` and `action:icon` publish (`patch` left with the input,
 * which the spec retired on a row, objectui#12971). ONE file drives both blocks
 * through the same rows (`describe.each`), so each key's claim is identical on
 * the two and is written once here; `actionLeafMemberPins` spells it out per
 * block, so every id below still names its block and its key.
 */
const ACTION_LEAF_PIN_FILE =
  'packages/components/src/renderers/action/__tests__/action-button-icon-inputs-11168.test.tsx';
const ACTION_LEAF_MEMBER_CLAIMS: Record<string, string> = {
  visible:
    'The `object` arm is the CEL predicate envelope `{ dialect: \'cel\', source }`, mounted through the real `SchemaRenderer` with `data` bound: the holding envelope renders the control and its failing twin removes it, and the boolean and bare-CEL arms carry the same holds/fails pair, so a gate never consulted (equal verdicts) is red (objectui#11168 slice 1).',
  disabled:
    'The `object` arm is the CEL predicate envelope `{ dialect: \'cel\', source }`, mounted through the real `SchemaRenderer` with `data` bound: the holding envelope greys the control and its failing twin leaves it pressable, with the control ON SCREEN in both rows so "disabled" cannot read as "never rendered"; the boolean and bare-CEL arms carry the same pair (objectui#11168 slice 1).',
  params:
    'Members are the `ActionParam` definitions the runner collects: the whole list, in order and unchanged, is what the parameter-collection handler is handed, and the value collected for a member reaches the executor under that member\'s `name`; with no `params` nothing is collected and the action runs straight away (objectui#11168 slice 1).',
  bodyExtra:
    'Members are request-body fields, merged into the body the runner\'s built-in `api` executor sends, LAST: a member overrides a static `properties.params` value of the same name while the other static values survive; without the key the body is the static values alone (objectui#11168 slice 1).',
  bodyShape:
    'The `object` arm\'s one member is `wrap`: `{ wrap: \'data\' }` nests the static values under `data` with `bodyExtra` riding flat beside it, while `flat` and an absent key send the same flat body — asserted on the body the runner\'s built-in `api` executor sends (objectui#11168 slice 1).',
  locations:
    'Members are placement names, read at dispatch by `@object-ui/core`\'s `createServerActionHandler` (the console\'s `script` handler is built on it): a list carrying a record-scoped member (`record_header`) refuses to run with no record or selection in scope — an error toast and no request — while an object-level list (`list_toolbar`) runs (objectui#11168 slice 1).',
  toast:
    'Members `showOnSuccess` / `showOnError` / `duration`, each asserted on the toast handler the runner calls: `showOnSuccess: false` silences a success, `showOnError: false` silences a failure, and `duration` is handed to the toast; with no `toast` both outcomes are toasted (objectui#11168 slice 1).',
  resultDialog:
    'The spec reaches the reveal-dialog handler WHOLE (deep-equal, `fields` included) together with the response data, and it replaces the success toast. The runner reads no member itself — the members are the dialog\'s to interpret — so the pin is that none is dropped or rewritten on the way (objectui#11168 slice 1).',
  onSuccess:
    'Members `navigate` and `openIn`: `navigate` is interpolated from the response (`${result.id}` becomes the handler\'s id) and handed to the navigation handler, and `openIn: newTab` opens a tab where its absence navigates in place; with no `onSuccess` a successful action navigates nowhere (objectui#11168 slice 1).',
};
const actionLeafMemberPins = (type: 'action:button' | 'action:icon'): Record<string, MemberPin> =>
  Object.fromEntries(
    Object.entries(ACTION_LEAF_MEMBER_CLAIMS).map(([key, pins]) => [
      `${type}.${key}`,
      { file: ACTION_LEAF_PIN_FILE, pins },
    ]),
  );

/**
 * The per-block member pins this repo has, by key.
 *
 * An entry is a claim that the named file constrains the member shape the
 * RENDERER reads for that key — the criterion objectui#8068 sets, and the one
 * thing here that is reviewed rather than computed. `pins` says which assertion
 * carries the claim, so the next reader can check it in one hop instead of
 * re-deriving why the file counts.
 *
 * The four objectui#8068 names are all here: the three the LIMIT note at the top
 * of this file already delegated to (`record:details.sections`,
 * `record:highlights.fields`, `record:related_list.add`) and the fourth that
 * arrived with objectui#6252's fix rather than from any mechanism
 * (`page:header.actions`). They are asserted BY NAME below, because they are the
 * calibration for everything else: if the population or the locator ever stops
 * recognising those four, this direction has stopped describing the defect it
 * was built for.
 */
/**
 * The one file that measures the `list-view` keys objectui#13047 published, and
 * pins the members of every structured one but `dataSource`.
 */
const LIST_VIEW_PIN_FILE = 'packages/plugin-list/src/__tests__/ListViewBlock.specInputs-13047.test.tsx';
const LIST_VIEW_13074_PIN_FILE = 'packages/plugin-list/src/__tests__/ListViewBlock.inertKeys-13074.test.tsx';
const LIST_VIEW_13089_PIN_FILE = 'packages/app-shell/src/views/__tests__/PageView.listViewAddRecord-13089.test.tsx';

const MEMBER_PINS: Record<string, MemberPin> = {
  ...actionLeafMemberPins('action:button'),
  ...actionLeafMemberPins('action:icon'),
  'action:group.actions': {
    file: 'packages/components/src/renderers/action/__tests__/action-group-menu-inputs-11168.test.tsx',
    pins: 'Members are ACTION OBJECTS the group draws and runs itself, driven through the real `SchemaRenderer`: `label` is the button text (the dropdown falls back to `name`), a member\'s own `visible` / `disabled` gate THAT member only (a sibling is the control), `variant`, `size` and `className` style it, with a member `size` outranking the group\'s and the group\'s outranking the `sm` fallback, `tags: [separator-before]` draws the dropdown divider, and `locations` is what the group\'s `location` filters on. A click hands the runner the member under its OWN `type` with its own keys (`target`, `objectName`). The list kind is pinned against the contract as well: the spec refuses an `object` at `actions` by kind and accepts a list of objects, which is the narrowing objectui#11168 slice 1 made to the declaration.',
  },
  'action:group.visible': {
    file: 'packages/components/src/renderers/action/__tests__/action-group-menu-inputs-11168.test.tsx',
    pins: 'The `object` arm is the CEL predicate envelope `{ dialect: \'cel\', source }`, mounted through the real `SchemaRenderer` with `data` bound: an envelope that holds renders the group and its twin that fails hides it, and the boolean and bare-CEL arms carry the same holds/fails pair — every row asserts both halves, so a gate never consulted (equal verdicts) is red (objectui#11168 slice 1).',
  },
  'action:menu.actions': {
    file: 'packages/components/src/renderers/action/__tests__/action-group-menu-inputs-11168.test.tsx',
    pins: 'Members are ACTION OBJECTS, one menu item each, read through the real `SchemaRenderer` with the Radix menu opened: `label` is the item text (falling back to `name`), a member\'s own `visible` hides and its own `disabled` greys THAT item (a sibling is the control), `tags: [separator-before]` draws the divider, `variant: destructive` paints the item, and selecting an item hands the runner the member under its OWN `type` with its own keys (`target`, `objectName`). The list kind is pinned against the contract: the spec refuses an `object` at `actions` by kind and accepts a list of objects (objectui#11168 slice 1).',
  },
  'action:menu.visible': {
    file: 'packages/components/src/renderers/action/__tests__/action-group-menu-inputs-11168.test.tsx',
    pins: 'The `object` arm is the CEL predicate envelope `{ dialect: \'cel\', source }`, mounted through the real `SchemaRenderer` with `data` bound: an envelope that holds renders the trigger and its twin that fails hides the whole menu, with the boolean and bare-CEL arms carrying the same holds/fails pair (objectui#11168 slice 1).',
  },
  'element:definition-list.items': {
    file: 'packages/components/src/renderers/basic/__tests__/element-list-inputs-11168.test.tsx',
    pins: 'Members are `{ term, description }` items, read through the real `SchemaRenderer`, one `<dt>`/`<dd>` row each in list order: `term` is the row label, `description` is shown as-is (a string or number verbatim, an object as JSON, an omitted one as an em dash). The `label` / `value` spelling is read by nothing (a blank term and an em dash beside a control row carrying the same text under the read members), and the spec row refuses it by name. The key itself is optional, as the renderer reads it: absent renders "No details", and the page validator no longer reports it missing (objectui#11168 slice 2).',
  },
  'element:repeater.fields': {
    file: 'packages/components/src/renderers/basic/__tests__/element-list-inputs-11168.test.tsx',
    pins: 'Members are a bare field name or `{ field }`, read through the real `SchemaRenderer` over a recording adapter: each prints that field\'s value of the record, in list order after the title, and a field the record lacks prints an em dash. A `label` member is never printed (the list has no header row) while its `field` still is, and the spec row refuses it; the key declares no `of` because its member contract is that union (objectui#11168 slice 2).',
  },
  // `element:repeater.filter` and `.sort` stood here (objectui#11168 slice 2).
  // objectui#12085 stopped publishing them: the query's members are the
  // binding's, pinned under `element:repeater.dataSource` below, and the flat
  // keys are covered by `UNPUBLISHED_EXEMPTIONS` until the pin that carries
  // objectstack#11509's tombstones.
  'element:repeater.dataSource': {
    file: 'packages/components/src/renderers/basic/__tests__/data-list.elementDataSource-11880.test.tsx',
    pins: 'The per-element binding\'s members as this LIST reads them, through the REAL renderer and asserted at the read it issues (objectui#11880). The binding is read FIRST and the flat `properties` query keys are its fallback, for metadata written before the spec retired them (objectstack#11509); since objectui#12085 the registration publishes the binding alone: a repeater bound only through `dataSource` lists its rows (it showed "No records" before), the flat keys alone read exactly as before, and a binding naming no object supplies nothing. Beside the flat keys, the precedence is `ElementDataSourceGate`\'s one table: `object` is the binding\'s; `filter` is the flat one AND-combined with the binding\'s (itself AND its saved view\'s), so neither is dropped; `sort` / `limit` are the binding\'s own, else the flat key, else the saved view\'s, and a refused cap (`0`) is not authored. An unresolvable `view`, or a filter the merge\'s lowering refuses, REPORTS on the error panel and issues no read. The bus re-reads for the BOUND object, not the flat one beside it. ⚠️ The key is INJECTED by `Registry.register` (`ELEMENT_DATA_SOURCE_INPUT`), not written by the block: the declaration lists the binding\'s five members generically, and this pin carries which of them THIS block reads.',
  },
  'element:button.action': {
    file: 'packages/components/src/__tests__/elementButtonActionMembers-8071.test.tsx',
    pins: 'The inline ActionDef\'s member set as a WHITELIST, driven through the real renderer and asserted on what the ActionRunner is handed: the forwarded keys are pinned as a SORTED SET, so a member silently added to or dropped from `ElementButtonRenderer`\'s explicit forward list is red in either direction — the defect shape objectstack#6837 (`bodyExtra`) and objectstack#6938 (`bodyShape`) were both filed for, an authored key that validates, publishes and then evaporates one hop before the runner. Three off-list keys are authored alongside and asserted ABSENT: `bodyShape` (deliberately not inline vocabulary — `action-bodyShape-forward.test.tsx` argues the boundary in prose, this pins it as behaviour) plus `icon` and `variant`, the block\'s own sibling props misplaced one level in. `actionType` OUTRANKS `type` with the losing spelling\'s handler asserted un-run, an ARRAY `params` is re-routed to `actionParams` while an OBJECT `params` stays `params` (objectstack#5777 direction A) with each arm controlling the other, the navigation members reach the navigation handler, and an omitted `action` dispatches nothing at all — the non-vacuity control for every row. LIMIT: `confirmText` is on the whitelist but unexercised, because the runner awaits confirmation before the dispatch this file observes. New file (objectui#8071 slice 7).',
  },
  'element:button.label': {
    file: 'apps/console/src/__tests__/component-input-union-specimens.test.ts',
    pins: 'The `object` arm is the inline translation map `{ en, "zh-CN" }` and nothing else — driven through the real `manifestFromConfigs` + `validateTree` pair the JSX-page compiler and the save gate use, each positive paired with a value matching NEITHER arm that must still be reported (objectui#4970).',
  },
  'element:number.dataSource': {
    file: 'packages/components/src/renderers/basic/__tests__/elementNumber.dataSourceBinding-10909.test.tsx',
    pins: 'The per-element binding\'s members as this METRIC reads them, through the REAL renderer and asserted at the call it fires, with the whole options bag compared so a member forwarded by accident is red. Read: `object` is what gets aggregated, and since objectui#11880 the ONLY object (one value for the fetch guard, `aggregate` / `find` and the `useDataInvalidation` key — a bus event for a flat `properties.object` beside it does not re-read, one for the bound object does); while a named `view` is unresolved there is NO object, so nothing is aggregated; a named `view`\'s `filter` scopes the aggregate, and an unresolvable `view` REPORTS and aggregates nothing; `filter` is the binding\'s (AND-combined with its view\'s), lowered, and the flat `properties.filter` is not read — a binding filter the converter refuses REPORTS on the error panel and aggregates nothing. Not read: `sort` and `limit`, from the binding or from the view, never reach `aggregate()` or the `find()` fallback, because an aggregate has no ordering and a capped count is a wrong number. A binding naming no object supplies nothing, and the flat `properties` form alone shows the no-object notice and aggregates nothing (objectui#11880). ⚠️ The key is INJECTED by `Registry.register` (`ELEMENT_DATA_SOURCE_INPUT`), not written by the block: the declaration lists the binding\'s five members generically (`{ object, view, filter, sort, limit }`) and does not say which of them THIS block reads — that per-block half is what this pin carries (objectui#10909).',
  },
  // `element:number.filter` stood here (objectui#8071 slice 7). objectui#12085
  // stopped publishing it: the metric's filter is the binding's, pinned under
  // `element:number.dataSource` above.
  'element:record_picker.dataSource': {
    file: 'packages/components/src/__tests__/record-picker-element-data-source.test.tsx',
    pins: 'The per-element binding\'s own members, read through the REAL renderer and asserted at the query it fires: `view` resolves a saved view whose `filter`/`sort`/row cap become the picker\'s baseline, an authored binding key WINS over the same key from the view, the binding\'s own `filter` arrives AND-combined with the view\'s rather than replacing it, and an unresolvable `view` reports instead of falling back to every record of the object — the quieter failure mode objectstack#6953 fixed, one class below the throw objectstack#5576 fixed on `list-view`. A `view`-less binding passes its own keys through as authored, which is the control that keeps the override rows from reading as a coincidence; and since objectui#11880 the four flat keys (`object`/`filter`/`sort`/`limit`) are read by nothing — a flat `properties.object` alone issues no query, and beside a binding the flat `filter`/`sort`/`limit` change nothing. `columns` is deliberately absent from this pin: unlike `record:related_list.dataSource` (objectui#8071 slice 2), this renderer never reads `composed.columns` at all — a select dropdown has no column list to narrow. Pre-existing file, promoted to a pin here after being read end to end (objectui#8071).',
  },
  'element:record_picker.emptyText': {
    file: 'apps/console/src/__tests__/component-input-union-specimens.test.ts',
    pins: 'The `object` arm is the inline translation map, asserted at the render site that actually resolves one, with the non-matching controls (`42`, `["No records"]`) still reported (objectui#3832).',
  },
  // `element:record_picker.filter` and `.sort` stood here until the `@objectstack/spec`
  // 18 bump retired both as tombstones and the registration stopped publishing them
  // (objectui#12030): a member pin names a key still array/object-armed on a covered
  // block, and neither is. The binding's `dataSource.sort` reach is still pinned by
  // `record-picker-sort-members.test.tsx`, and the binding itself by `.dataSource` below.
  'element:record_picker.label': {
    file: 'packages/components/src/renderers/basic/__tests__/record-picker-label-placeholder-i18n.test.tsx',
    pins: 'The I18nLabel object arm, resolved at ITS OWN read site rather than through the row-value helper `toText` it used to share: the map resolves to the active language rather than always to its `en` entry (the pre-fix harm rendered ENGLISH to a zh-CN viewer), a region tag falls back to the base language an author actually wrote, and — the quiet failure — a legal map that simply omits `en` used to delete the `<label>` element with nothing thrown and nothing logged; this pin asserts the element\'s PRESENCE first, then its text, so a fix that resolved the string but left the element gone still fails here. A plain-string control and the "absent key renders no label at all" control both stay green in every case, which is what keeps the object-arm rows from being satisfied by an always-render fix (objectui#5637).',
  },
  'element:record_picker.placeholder': {
    file: 'packages/components/src/renderers/basic/__tests__/record-picker-label-placeholder-i18n.test.tsx',
    pins: 'The I18nLabel trio\'s other object arm, on the sharper of the two pre-fix failures: an authored map THREW `Objects are not valid as a React child` at `SelectValue`, taking the whole control down rather than merely mis-rendering. Same resolver, same fallback chain and the same base-language control as `label` above; see that entry (objectui#5637).',
  },
  'element:text.content': {
    file: 'apps/console/src/__tests__/component-input-union-specimens.test.ts',
    pins: 'The `object` arm is the inline translation map, derived from the spec\'s own verdicts rather than restated, with a non-matching control (objectui#4970).',
  },
  'element:text_input.description': {
    file: 'packages/components/src/__tests__/text-input-inputs-spec-parity.test.ts',
    pins: 'The I18nLabel trio: the declared arms equal the arms the spec accepts as a SET in both directions, the `object` arm is the locale map, and the description must teach `zh-CN` and the locale-aware resolution the read site performs (objectui#5717).',
  },
  'element:text_input.label': {
    file: 'packages/components/src/__tests__/text-input-inputs-spec-parity.test.ts',
    pins: 'The I18nLabel trio — see `element:text_input.description` (objectui#5717).',
  },
  'element:text_input.placeholder': {
    file: 'packages/components/src/__tests__/text-input-inputs-spec-parity.test.ts',
    pins: 'The I18nLabel trio — see `element:text_input.description` (objectui#5717).',
  },
  // objectui#13047 — every array/object-armed input `list-view` publishes,
  // measured through the real `SchemaRenderer` and the `list-view` registration
  // in one file (`LIST_VIEW_PIN_FILE`); `dataSource` in the binding's own file.
  // The six the objectstack `main` pin bump booked (`data`, `columns`, `filter`,
  // `sort`, `options`, `dataSource`) are among them.
  'list-view.appearance': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'Two members, measured apart. `showDescription: false` hides the description the same node declares (the info control is gone). `allowedVisualizations` narrows the kinds a view SWITCHER offers, and a page node draws no switcher (`showViewSwitcher` is a host prop, not a key of the row), so a node whitelisting `[\'grid\']` still draws its authored kanban: the member is inert on a page node, which the registration\'s description says rather than hides (objectui#13047).',
  },
  'list-view.bulkActionDefs': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'Members are the spec\'s `BulkActionDef` objects (`of: \'object\'`, the contract\'s single member kind): a definition list reaches the `object-grid` node `ListView` builds unchanged, member for member, and an absent key puts none there. The grid\'s own execution of a definition is `object-grid.bulkActionDefs`\'s pin (objectui#13047).',
  },
  'list-view.bulkActions': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'Members are action NAMES (`of: \'string\'`): the list reaches the `object-grid` node `ListView` builds as its `batchActions`, in order, and an absent key puts none there. The bar the grid draws from them is `object-grid.bulkActions`\'s pin (objectui#13047).',
  },
  'list-view.calendar': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The calendar block\'s binding members `startDateField`, `endDateField` and `titleField`, each reaching the `object-calendar` node `ListView` builds under its own name; with no block, a `type: \'calendar\'` node hands the calendar no start date (objectui#13047).',
  },
  'list-view.chart': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The ADR-0021 binding members `dataset`, `values` and `dimensions`, reaching the `object-chart` node `ListView` builds for a `type: \'chart\'` node unchanged (objectui#13047).',
  },
  'list-view.columns': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'Members are field NAMES in the authored order: they project the query (`$select` carries them and not a field they leave out) and the `object-grid` node `ListView` builds draws them in that order (objectui#13047).',
  },
  'list-view.conditionalFormatting': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'Members are the list view\'s own `{ condition, style }` rules (`of: \'object\'`): the rule list reaches the `object-grid` node `ListView` builds unchanged, and an absent key puts none there. Painting a matched row is `object-grid.conditionalFormatting`\'s pin (objectui#13047).',
  },
  'list-view.data': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The spec\'s `ViewData`, two providers measured apart: `{ provider: \'object\', object }` lists that object (the adapter\'s `find` receives it and the grid is handed its rows), and `{ provider: \'value\', items }` hands the grid those rows and queries nothing (objectui#13047).',
  },
  'list-view.dataSource': {
    file: 'packages/plugin-list/src/__tests__/ListView.elementDataSource.test.tsx',
    pins: 'The per-element binding\'s members on a page `list-view` node, asserted at the query the adapter receives: `object` is the queried object; a named `view` contributes its columns (`$select`), filter and sort; the binding\'s own `filter` is AND-combined with the view\'s, never replacing it; its own `sort` and `limit` (as `$top`) outrank the view\'s; columns authored on the node win over the view\'s; and an unresolvable `view` renders a configuration error naming the view, the object and the views it has, and queries nothing. The key is INJECTED by `Registry.register` (`ELEMENT_DATA_SOURCE_INPUT`), so the per-block half is what this pin carries. Pre-existing file (objectstack#5576), read end to end before being cited (objectui#13047).',
  },
  'list-view.description': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The I18nLabel arms: a plain string is the toolbar info control\'s accessible name, an inline locale map paints its `zh-CN` entry under a `zh-CN` display locale with `en` listed FIRST so a fallback fails the row, and an absent key draws no info control (objectui#13047).',
  },
  'list-view.emptyState': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'Two of the strict `EmptyState` members, `title` and `message`, drawn in place of the default empty copy when no record comes back; the same node with no `emptyState` draws neither. `icon` and `link` are this package\'s `ListView.emptyState*` pins on the bare `ListView` (objectui#13047).',
  },
  'list-view.exportOptions': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'Two members: declaring `{ formats: [\'csv\'] }` offers the toolbar export in that format (an absent key offers none), and `fileNamePrefix` leads the downloaded file\'s name, read off the download anchor (objectui#13047).',
  },
  'list-view.fieldOrder': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'Members are field NAMES (`of: \'string\'`): they order the columns left after `hiddenFields` on the `object-grid` node `ListView` builds, and a surviving column the list does not name sorts LAST (objectui#13047).',
  },
  'list-view.filter': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'Members are the spec\'s `ViewFilterRule` objects `{ field, operator, value }`: they reach the query\'s `$filter` carrying the field and the value, and an absent key sends no `$filter` (objectui#13047).',
  },
  'list-view.gallery': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The gallery block\'s `coverField` (reaching the `object-gallery` node\'s nested `gallery` config) and `titleField` (its flat title binding); with no block, a `type: \'gallery\'` node hands no cover field (objectui#13047).',
  },
  'list-view.gantt': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The gantt block\'s binding members `startDateField`, `endDateField` and `titleField`, each reaching the `object-gantt` node `ListView` builds; with no block, a `type: \'gantt\'` node hands the chart no start date (objectui#13047).',
  },
  'list-view.grouping': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'Members are `{ field, order }` entries under `fields`: over an adapter that answers the group header query the entry reaches the `object-grid` node `ListView` builds, and over one that cannot, the list draws its refusal instead of grouping one page and mounts no grid (objectui#13047).',
  },
  'list-view.hiddenFields': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'Members are field NAMES (`of: \'string\'`): each subtracts its column from the `object-grid` node `ListView` builds, and a name the columns never projected subtracts nothing (objectui#13047).',
  },
  'list-view.kanban': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The kanban block\'s `groupByField` (the board\'s lane field, handed as `groupBy`), `titleField` and `columns` (handed as the card fields); with no block, the board lanes on a field the list derives rather than the one this row names (objectui#13047).',
  },
  'list-view.label': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The I18nLabel arms at the export file name: a plain string names the downloaded file, an inline locale map names it by its `zh-CN` entry under a `zh-CN` display locale with `en` listed FIRST (and never as `[object Object]`), and the same node with no label does not. The record-detail drawer heading carries the string arm in the `navigation` row (objectui#13047).',
  },
  'list-view.map': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The map block\'s `latitudeField` and `longitudeField`, each reaching the `object-map` node `ListView` builds; with no block, a `type: \'map\'` node hands no coordinate binding (objectui#13047).',
  },
  'list-view.navigation': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The `mode` member: `drawer` opens the clicked row\'s record in a dialog headed by the list\'s `label`, and the same node with no `navigation` opens none (objectui#13047).',
  },
  'list-view.options': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The per-kind bag: `options.kanban.groupByField: \'owner\'` lanes the board on `owner` and its `columns` become the card fields, read off the `object-kanban` node `ListView` builds, against a CONTROL bare kanban node that lanes on a field the list derives itself (not `owner`), so the row reads the bag and not the default (objectui#13047).',
  },
  'list-view.pagination': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The `pageSize` member caps the query (`$top`), and the same node with no `pagination` sends the default page (objectui#13047).',
  },
  'list-view.addRecord': {
    file: LIST_VIEW_13089_PIN_FILE,
    pins: 'Through the real `PageView`: `enabled: true` draws the Add button, and a click pushes `form=new` + `formObject` for the listed object (no `formLink`), or navigates to the full-page create route for an `editMode: \'page\'` object; no create grant, and a create the object greys, withhold it; a node without the key draws none. Controls: an unbound `record:related_list` on the same page draws no `+ New`, and a parent-less resolve is served `onCreate` alone (objectui#13089).',
  },
  'list-view.requiredPermissions': {
    file: LIST_VIEW_13074_PIN_FILE,
    pins: 'Members are CAPABILITY names, ALL required, read through `hasCapabilities` under a real stock `MePermissionsProvider`: an unheld capability puts the insufficient-permissions notice in place of the list and no `find` is sent; a held one draws and queries the list; a PARTIAL grant on a two-entry array is gated (the `.every` row, with the full grant as its control); an empty array and an absent key are no gate; and a provider that reports no `systemPermissions` fails open (objectui#13074).',
  },
  'list-view.rowActions': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'Members are action NAMES (`of: \'string\'`): the list reaches the `object-grid` node `ListView` builds unchanged, and an absent key puts none there. The row menu the grid draws is `object-grid.rowActions`\'s pin (objectui#13047).',
  },
  'list-view.rowColor': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The `field` and `colors` members reach the `object-grid` node `ListView` builds unchanged, and an absent key puts none there. Painting the rows is `object-grid.rowColor`\'s pin (objectui#13047).',
  },
  'list-view.searchableFields': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'Members are field NAMES (`of: \'string\'`): a term typed into the toolbar search box is sent with `$searchFields` naming exactly them, and the same term on a node with no list sends no `$searchFields` (objectui#13047).',
  },
  'list-view.selection': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The `type` member reaches the `object-grid` node `ListView` builds unchanged, and an absent key puts no selection there (objectui#13047).',
  },
  'list-view.sort': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'Members are `{ field, order }` objects: they reach the query\'s `$orderby` in the order written, each with its own order (objectui#13047).',
  },
  'list-view.timeline': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The timeline block\'s `startDateField` (on the `object-timeline` node both flat and in its nested `timeline` config) and `titleField`; with no block, a `type: \'timeline\'` node hands no start date (objectui#13047).',
  },
  'list-view.tree': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The tree block\'s `parentField` and `labelField`, each reaching the `object-tree` node `ListView` builds; with no block, a `type: \'tree\'` node hands no parent field (objectui#13047).',
  },
  'list-view.userActions': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'Members are per-control toggles: `sort: false` takes the Sort control off the toolbar while the Filter control the same object does not name stays, and an absent key keeps both (objectui#13047).',
  },
  'list-view.userFilters': {
    file: LIST_VIEW_PIN_FILE,
    pins: 'The `element` and `fields` members: a `dropdown` over `stage` draws the quick-filter bar labelled by that field, and the same node with no `userFilters` draws none (objectui#13047).',
  },
  'object-calendar.calendar': {
    file: 'packages/plugin-calendar/src/__tests__/objectCalendarConfigMembers-8071.test.tsx',
    pins: 'Members are FIELD NAMES the calendar projects onto an event: `startDateField` and `endDateField` name the record fields that become the event\'s `start`/`end` (an unauthored `endDateField` leaves `end` undefined rather than inventing one), and `titleField` OUTRANKS the object\'s own default display-name resolution (`getRecordDisplayName`) rather than only supplementing it. The sharp claim is PRECEDENCE: `getCalendarConfig` returns `schema.calendar` OUTRIGHT the moment it is set — never merged against the flat legacy spelling (`startDateField/endDateField/titleField/colorField` authored directly on the schema) it falls back to only when `calendar` is absent — so a schema carrying BOTH, with the two disagreeing, is read entirely from the nested object and not at all from the flat siblings, even for the keys the nested object leaves unset. `colorField`\'s own resolution ladder and `allDayField` are each pinned narrowly already and are not re-asserted here: `ObjectCalendar.colorFieldLadder-7243.test.tsx`, `ObjectCalendar.allDayFieldIsHonoured-8026.test.tsx`. The spec side is a strict object of exactly the five documented keys — `allDayField` among them since `@objectstack/spec` 17.5.0, objectui-local before that (text corrected by objectui#11168 slice 3) — so it fixes the NAMES but nothing about how they are used once read: the read site is the whole member contract (objectui#8071).',
  },
  'object-calendar.data': {
    file: 'packages/plugin-calendar/src/__tests__/ObjectCalendar.recordSourceMembers-8314.test.tsx',
    pins: 'The members are RECORDS, and the keys read inside one are the fields the declared `calendar` config names plus `id`: every member arrives in authored order, `allDay` is derived PER MEMBER from the declared end field, a member with no value in the start field is counted in the unscheduled area rather than dropped or given a fabricated date (objectui#7071 at the member level), and a member with no `id` gets a synthesised one rather than being discarded. Asserted through the REAL `SchemaRenderer`, because this key\'s sink is the props channel `index.tsx` resolves (`resolveExternalData`), not the schema. ⛔ NOT pinned on "the internal query is skipped": an authored array reaches this renderer on BOTH carriers, and the schema-channel one returns it as a config with no `provider`, so no query is issued on a tree where the boundary drops `data` either — measured by ablation, that row stays green while the ROWS-ARE-DRAWN rows go red, so it is kept as a labelled companion and the rows carry the claim. The spec side cannot supply any of it: the row is `z.array(z.unknown())`, so every coarse member kind parses and the read site is the whole member contract (objectui#8314).',
  },
  'object-calendar.dataSource': {
    file: 'packages/plugin-calendar/src/ObjectCalendar.elementDataSource.test.tsx',
    pins: 'The per-element binding\'s own members, read through the REAL `ElementDataSourceGate` + renderer pair and the same shared mapping mechanism `element:record_picker.dataSource` and `record:related_list.dataSource` already pin: `object` WRITES onto `objectName` (this block\'s own top-level key), a named `view`\'s `filter`/`sort` reach the fetch as `$filter`/`$orderby`, a `sort` member missing `order` reads as ascending rather than dropped (the shared `QueryParams.$orderby` member contract, objectui#4022), an unresolvable `view` reports instead of fetching the whole object, and a calendar carrying no binding at all behaves exactly as it did before one existed. `columns` and a row cap are deliberately UNMAPPED and asserted absent from the mapping\'s own declaration (`OBJECT_CALENDAR_DATA_SOURCE = { filter: true, sort: true }` in `index.tsx`) rather than pinned here, because this block projects fields off its own `calendar` config and fetches the whole window — neither key has a read site to write to. Pre-existing file, promoted to a pin here after being read end to end (objectstack#6953, objectui#8071).',
  },
  'object-calendar.filter': {
    file: 'packages/plugin-calendar/src/__tests__/ObjectCalendar.filterIsNotAConfigSlot-7711.test.tsx',
    pins: 'The members are ObjectQL `$filter` elements, and this renderer adds nothing to that contract and subtracts nothing from it: the authored value reaches `dataSource.find` as `$filter` BY IDENTITY (`toBe`, so a normalising rewrite cannot pass), and the retired `filter.calendar` member spelling yields NO configuration — one authored key read twice with two incompatible meanings is the member-level defect objectui#7711 closed here and objectui#4034 closed on the map. Both member forms are covered (the object form and the array-of-arrays form) as values the renderer passes through, not as authored ones: the AUTHORED member is the spec row\'s `ViewFilterRule` array `[{ field, operator, value }]`, which refuses both (and so does `@object-ui/types` since objectui#6152 round 8, which took the row\'s member by reference); the renderer reads none of it, so the wire carries whatever reaches the node, a host-composed AST included (objectui#7711, registered as a pin by objectui#8176 once objectui#8186 declared the key).',
  },
  'object-calendar.navigation': {
    file: 'packages/plugin-calendar/src/__tests__/calendarNavigationMembers-8652.test.tsx',
    pins: 'The members of the spec\'s `NavigationConfigSchema` block the calendar reads, each driven through a real event click on the real calendar and asserted on what the click DID: an ABSENT key opens a drawer (the renderer\'s own default, the lit control), `none` and `preventNavigation` open nothing with the flag outranking an overlay mode, `new_window` and `openNewTab` open the record page in a new tab with `openNewTab` outranking `page` and every overlay mode but not `none` (objectui#11168 slice 5), and `size` / `width` are one width decision (`width` wins, a bucket resolves through the size table, `auto` lands on the default). The precedence against a parent view is pinned both ways: an OVERLAY mode keeps the click from `onRowClick` / `onEventClick`, any other mode hands it to them. Since objectui#11293 the `page` rows pin the navigation the description states: under a host that publishes its record navigator, `page` and a block without `mode` open the record page through it (no overlay, no new tab), with `drawer` as the lit control and a parent `onRowClick` taking the click first; with no host navigator `page` opens nothing (objectui#8652, objectui#11293).',
  },
  'object-calendar.sort': {
    file: 'packages/plugin-calendar/src/__tests__/ObjectCalendar.sortMembersReachTheWire-8171.test.tsx',
    pins: 'The members are `{ field, order }` and those two keys are the whole of what this renderer reads inside one: `{ field, order }` lowers to the `field -> direction` map on `$orderby`, an omitted `order` is ascending rather than a dropped member (the objectui#4022 regression), every member arrives in authored order, and a member with no usable `field` is dropped rather than given an invented one — with an unauthored `sort` reaching the wire as `undefined` as the control. Also carries objectui#7711\'s case transposed: a sort on a field named `calendar` stays a sort and the config still comes from the declared `calendar` container. ⛔ NOT an identity pin, unlike the two `filter` entries: `ObjectCalendar.tsx` writes `$orderby: convertSortToQueryParams(schema.sort)`, which builds a new map, so `toBe` is false about this key — the pin asserts what is read inside the member instead, which is the sharper claim. The spec side cannot supply any of it: the `sort` row is unconstrained (an array, a bare string and a bare number all parse), so the wire is the whole member contract (objectui#8171).',
  },
  'object-calendar.staticData': {
    file: 'packages/plugin-calendar/src/__tests__/ObjectCalendar.recordSourceMembers-8314.test.tsx',
    pins: 'The members are read EXACTLY as `data`\'s are (same record keys, same per-member unscheduled treatment), plus the two POSITION claims its description makes and no other direction of this gate can see: it is rung 2 of the shared record-source ladder, so an authored `data` wins and this key contributes nothing, and it is read ABOVE `objectName`, so a calendar carrying both draws the inline rows and never queries the object. Both negatives are proven through the same wait a CONTROL row shows a real query completing in, so "no query" can never read as a race. The spec row is `z.array(z.unknown())` — unconstrained members, read site is the whole contract (objectui#8314).',
  },
  'object-form.cancelText': {
    file: 'packages/plugin-form/src/ObjectForm.i18nLabels.test.tsx',
    pins: 'The I18nLabel object arm, resolved once above the `formType` fork: through the real `SchemaRenderer`, the `{ type, properties }` document under a `zh` UI, every map listing `en` FIRST so an `en` or first-entry fallback fails the row. A `properties.cancelText` map renders its `zh-CN` entry on the simple form\'s Cancel button and in the drawer and modal footers; read raw it was a Button child and the node rendered `Component "form" failed to render` with "Objects are not valid as a React child" before objectui#10993. A plain-string control renders as authored. The manifest half (a map is not a `type-mismatch`) is `objectFormI18nLabelManifest.test.ts` in this directory (objectui#10993).',
  },
  'object-form.customFields': {
    file: 'packages/plugin-form/src/__tests__/objectFormCustomFieldsMembers-8071.test.tsx',
    pins: 'Members are WHOLE field definitions keyed by `name`, rendered in AUTHORED order, and they REPLACE the metadata-generated set rather than merging over it — the object\'s schema is never even fetched (`getObjectSchema` asserted at zero calls), an object field no member names is absent, and a member naming a declared field carries its OWN label, inheriting nothing. That contradicts the registration\'s own prose ("Field definitions merged over the set generated from object metadata"): the per-member merge does exist as code (`customFields?.find((f) => f.name === name)`) and is unreachable, because the branch holding it runs only when the key is absent or empty — handed back as a finding rather than repaired, since repairing it is a renderer or spec change. The row a plausible improvement breaks is the gate\'s `.length > 0`: an EMPTY array is UNAUTHORED and the metadata path runs, so simplifying the read to `!!schema.customFields` turns a designer\'s not-configured-yet `[]` into a form with no fields and no diagnostic. A fifth row pins the SECOND read site of the same member count one layer up — `requiresDataSource={!(schema?.customFields?.length > 0) …}` in `index.tsx` — driven through the REGISTERED block with the identical node minus the members reporting the no-adapter panel as its control. Both declared sides are unconstrained (`type: \'array\'` with no `of`; the spec row is `z.unknown()`), so the read site is the whole member contract. New file (objectui#8071 slice 11).',
  },
  'object-form.dataSource': {
    file: 'packages/plugin-form/src/ObjectForm.elementDataSource.test.tsx',
    pins: 'The per-element binding\'s own members on a block that edits ONE record: `object` is the only key mapped, and it is asserted at the fetch it causes (`getObjectSchema` on the bound name) rather than at a prop. The keys deliberately NOT mapped are pinned as behaviour with a resolving `view` authored beside a `limit` and a `sort` — no collection query is issued at all, so none of the three can have silently become one — while an unresolvable `view` REPORTS rather than rendering as if it resolved, and a binding-free form is the control that keeps the negatives from reading as a block that never wired anything. Pre-existing file, promoted after being read end to end and GROWN by the row it never stated: the binding\'s `object` OUTRANKS a flat `objectName` on the same node (`next[objectKey] = composed.object`, unconditional), so the `??=` spelling a contributor would write to "not clobber the author" would leave a rebound form editing the old object with the same fields, the same labels and no diagnostic. `dataSource` is absent from `ComponentPropsMap[\'object-form\']` entirely — it is the injected `ELEMENT_DATA_SOURCE_INPUT` — so nothing declared constrains the precedence (objectui#8071 slice 11).',
  },
  'object-form.description': {
    file: 'packages/plugin-form/src/ObjectForm.i18nLabels.test.tsx',
    pins: 'The I18nLabel object arm as the drawer and modal SUBTITLE — see `object-form.cancelText` for the harness. A `properties.description` map renders its `zh-CN` entry inside the open dialog of both presentations, where the raw read threw as a React child before objectui#10993; a plain-string control renders as authored (objectui#10993).',
  },
  'object-form.fields': {
    file: 'packages/plugin-form/src/__tests__/objectFormFieldsMembers-8071.test.tsx',
    pins: 'Members are BARE FIELD NAMES resolved against the object schema — authored order preserved (against a control with no `fields`, whose order differs), a name the object does not declare dropped rather than rendered as an untyped stub, and the `{ name }` object spelling recorded as the read site\'s tolerance rather than a second contract. The sharp row is the one no other file can make: `object-form` carries a SECOND surface spelled `fields` (`sections[].fields`), whose canonical member is the spec `FormFieldSchema` object keyed on `field` — and that exact entry as a member of the TOP-LEVEL key resolves to no name and is dropped from render (no throw) — SILENTLY until objectui#8738 route 1 added a named `console.warn` for exactly this case (also pinned in the same file), with the same entry inside a section rendering as the live control so the negative cannot come from an object that never renders that field. Asserted through the real `ObjectForm`, because the sink is its own `fieldsToShow` loop rather than the `normalizeSectionField` chokepoint the sibling key uses. The spec row is `z.array(z.unknown())` and the registration declares no `of`, so the read site is the whole member contract (objectui#8071).',
  },
  'object-form.initialData': {
    file: 'packages/plugin-form/src/__tests__/objectFormInitialMembers-8071.test.tsx',
    pins: 'Members are FIELD NAMES and each member value is that control\'s OPENING value, and — the row a plausible improvement breaks — the two keys are MERGED PER MEMBER (`{ ...initialValues, ...initialData }`, one shared `resolveInitialRecord(schema)` at every read site): `initialData` wins where it speaks and `initialValues` supplies every member it says nothing about, which is the precedence the prose ("alternate spelling … read FIRST") states. The sharp edge is pinned too: an EMPTY `initialData` contributes NOTHING rather than blanking the populated `initialValues` beside it. ⭐ Both of those rows were FLIPPED by objectui#9760, ⛔ not deleted — the choice used to be whole-object (`schema.initialData || schema.initialValues`, where `||` tests the OBJECT and `{}` is truthy, so an author who prefilled through `initialValues` and added a one-member `initialData` lost the rest with no warning and no empty state); objectui#8071 wrote pins only, so it recorded that and handed the defect back, and the maintainer ruling on objectui#9760 (batch #166 item 3, letter 甲) repaired it. A no-keys row renders the SAME controls empty as the non-vacuity control. Both keys are registered `type: \'object\'` and typed `Record<string, any>`, so every object parses on both declared sides and the read site is the whole member contract (objectui#8071).',
  },
  'object-form.initialValues': {
    file: 'packages/plugin-form/src/__tests__/objectFormInitialMembers-8071.test.tsx',
    pins: 'Members are FIELD NAMES and each member value is that control\'s OPENING value, and — the row a plausible improvement breaks — the two keys are MERGED PER MEMBER (`{ ...initialValues, ...initialData }`, one shared `resolveInitialRecord(schema)` at every read site): `initialData` wins where it speaks and `initialValues` supplies every member it says nothing about, which is the precedence the prose ("alternate spelling … read FIRST") states. The sharp edge is pinned too: an EMPTY `initialData` contributes NOTHING rather than blanking the populated `initialValues` beside it. ⭐ Both of those rows were FLIPPED by objectui#9760, ⛔ not deleted — the choice used to be whole-object (`schema.initialData || schema.initialValues`, where `||` tests the OBJECT and `{}` is truthy, so an author who prefilled through `initialValues` and added a one-member `initialData` lost the rest with no warning and no empty state); objectui#8071 wrote pins only, so it recorded that and handed the defect back, and the maintainer ruling on objectui#9760 (batch #166 item 3, letter 甲) repaired it. A no-keys row renders the SAME controls empty as the non-vacuity control. Both keys are registered `type: \'object\'` and typed `Record<string, any>`, so every object parses on both declared sides and the read site is the whole member contract (objectui#8071).',
  },
  'object-form.mobile': {
    file: 'packages/plugin-form/src/__tests__/objectFormMobileMembers-8071.test.tsx',
    pins: 'FIVE members are read and the registration\'s prose names three of them by example, so two — `stepperFieldsPerStep` and `stickyActions` — are read, change what renders, and are discoverable from nothing on either declared side (the spec row is `z.unknown()`). Pinned through the real renderer: `stickyActions` moves the action bar into the sticky footer while the wrapper\'s `data-mobile-form` marker reads the KEY\'S PRESENCE rather than any member (an empty `mobile: {}` still stamps it and moves nothing); `stepper: true` routes through `WizardForm` UNCONDITIONALLY, asserted on a DESKTOP viewport and under a raised minimum so it cannot be read as a keener `auto`; and `stepper: \'auto\'` is gated on BOTH halves at once — the phone viewport AND the field count reaching `stepperMinFields` (default 8) — as three cells that each control the other two. The row a plausible improvement breaks is `stepperFieldsPerStep`: it is in neither declared side, so collapsing `Math.max(1, … ?? 1)` to a bare `1` reads like deleting an undeclared key, leaves every other row green, and silently turns an authored two-per-step form into one step per field. The fifth member, `fullscreenLongText`, is deliberately left to `ObjectForm.mobileFullscreen.test.tsx`, which owns it end to end — splitting one member across two files would make a deletion in either read as coverage. New file (objectui#8071 slice 11).',
  },
  'object-form.nextText': {
    file: 'packages/plugin-form/src/ObjectForm.i18nLabels.test.tsx',
    pins: 'The I18nLabel object arm on the wizard\'s next-step button — see `object-form.cancelText` for the harness. With `formType: "wizard"` and two sections, a `properties.nextText` map renders its `zh-CN` entry and the button still advances the step; the control is a plain string rendered as authored. The map\'s `zh-CN` entry differs from the zh pack\'s own default for the button (objectui#10999), so a map dropped instead of resolved fails the row (objectui#10993).',
  },
  'object-form.prevText': {
    file: 'packages/plugin-form/src/ObjectForm.i18nLabels.test.tsx',
    pins: 'The I18nLabel object arm on the wizard\'s previous-step button, reached by advancing one step — see `object-form.nextText`. A `properties.prevText` map renders its `zh-CN` entry; the control is a plain string rendered as authored. The map\'s `zh-CN` entry differs from the zh pack\'s `wizard.back`, so a map dropped instead of resolved fails the row (objectui#10993).',
  },
  'object-form.sections': {
    file: 'packages/plugin-form/src/__tests__/objectFormSectionMembers-8071.test.tsx',
    pins: 'Members are section OBJECTS, pinned in the DEFAULT layout (the one a section-carrying form gets with no `formType`) on the six keys `SimpleObjectForm`\'s grouped branch reads. The member ORDER row FLIPPED with objectui#10475: it pinned `fields` read as a SET — a name filter over the parent field pool, so the OBJECT\'s order won and the authored member order was discarded — and now pins the AUTHORED order, the order the five sibling arms\' shared `buildSectionFields` draws and the sibling key `object-form.fields` on the same block preserves. The silent row: a section whose members resolve to no field is dropped WHOLE, heading included, so one mistyped member name costs a heading with nothing visibly wrong. `name` alone titles the section and a member carrying neither `name` nor `label` draws no divider at all; `collapsed` takes the members out of the DOM while `collapsible` is the SEPARATE member that makes the heading a control, so a section declared `collapsed` and not `collapsible` renders permanently closed with no affordance — each arm carrying its own control in the same call. A no-sections row is the non-vacuity control. The seventh key changed hands: this layout used to DROP a member\'s `description` — pinned as behaviour and handed back as a finding — and objectui#9779 made it copy the key onto the divider row, so the same row now pins the ARRIVAL, read off the divider itself with the same section\'s `label` in the same call as the live control. The gate that decides whether a member gets a divider row at all was NOT widened with it, so a member carrying a `description` and neither `name` nor `label` still draws no divider and still drops its blurb; that boundary is pinned beside it and handed back in turn. \u26a0\ufe0f The same key had a SECOND site, one layer later and \u26d4 not a shared path: `ObjectForm`\'s drawer map copied it onto the drawer\'s section config and `DrawerForm`\'s OWN two divider pushes \u2014 the explicit-sections one and the derived-fieldGroups one \u2014 rebuilt the row without it, so the drawer arm dropped the blurb on both routes a host can take into it while NOTHING watched that arm at all. objectui#9834 copied the key onto both pushes and registered the drawer arm\'s own pin, `packages/plugin-form/src/__tests__/drawerFormSectionDescription-9834.test.tsx`, which also records the one way that arm differs: its explicit-sections push is UNCONDITIONAL, so a member carrying a `description` and no heading renders the blurb alone there, where this layout draws no divider at all. `visibleWhen`, the `{ group }` reference form, the legacy `groups` spelling and the drawer arm\'s `description` are owned by their own neighbouring files and deliberately not re-pinned here. Both declared sides are unconstrained (bare `type: \'array\'`; `z.array(z.unknown())`), so the read site is the whole member contract. New file (objectui#8071 slice 11).',
  },
  'object-form.submitBehavior': {
    file: 'packages/plugin-form/src/ObjectForm.submitBehavior.test.tsx',
    pins: 'Which MEMBERS each declared `kind` arm reads, driven through the real `ObjectForm` submit path: `url` and `delayMs` on `redirect`, `title` and `message` on `thank-you` (both guarded on the discriminant, so no other arm reaches them), and NOTHING on `continue` or `next-record`. The two rows objectui#8071 added are the ones the key could silently lose: `delayMs` is pinned on the number the wait is armed with — the arm spells it `behavior.delayMs ?? 0`, and collapsing it to a bare `0` removes the readable pause while every destination assertion in this file and in `ObjectForm.submitRedirect.test.tsx` stays green — with the SAME declaration minus the member as the lit control, so an empty `armed` can never be a spy that sees nothing; and `next-record`, the fourth declared arm, is pinned reaching the confirmation panel (form unmounted, `successMessage` toasted) rather than its members, because it has none — an edit dropping it into `continue`\'s no-op would leave a spec-legal authored value doing something else with nothing red. The registration declares `type: \'object\'` with the arms in prose and `SubmitBehavior` types them as a discriminated union, so what PARSES is settled and what is READ off each arm was not (objectui#8071).',
  },
  'object-form.submitText': {
    file: 'packages/plugin-form/src/ObjectForm.i18nLabels.test.tsx',
    pins: 'The I18nLabel object arm on the Save button — see `object-form.cancelText` for the harness. A `properties.submitText` map renders its `zh-CN` entry on the simple form and in the drawer and modal footers; the controls are a plain string rendered as authored and, with nothing authored, the English `Create` (objectui#10993).',
  },
  'object-form.successMessage': {
    file: 'packages/plugin-form/src/ObjectForm.i18nLabels.test.tsx',
    pins: 'The I18nLabel object arm in the create-success toast of the simple form — see `object-form.cancelText` for the harness. A `properties.successMessage` map toasts its `zh-CN` entry after `create` resolves; with nothing authored the toast is still the English `Created` (objectui#10993).',
  },
  'object-form.title': {
    file: 'packages/plugin-form/src/ObjectForm.i18nLabels.test.tsx',
    pins: 'The I18nLabel object arm as the drawer and modal HEADING — see `object-form.cancelText` for the harness. A `properties.title` map renders its `zh-CN` entry inside the open dialog of both presentations, where the raw read threw as a React child before objectui#10993; a plain-string control renders as authored. A compile-time row in `packages/types`\' `object-form-i18n-label-members-10993.test.ts` holds all seven members of `ObjectFormSchema` equal to `I18nLabel | undefined` (objectui#10993).',
  },
  'object-grid.bulkActionDefs': {
    file: 'packages/plugin-grid/src/__tests__/bulkActionMembers-8071.test.tsx',
    pins: 'Members are FULL `BulkActionDef` OBJECTS, left as authored and never resolved against `objectDef.actions` — proven with a def naming an action the object does NOT declare, which still renders carrying its authored label. The negative is the pair\'s sharper half and is NOT silent: a bare-name member (the sibling key\'s vocabulary, which nothing on either declared side refuses) reaches `BulkActionBar` with no `name` and `formatActionLabel(undefined)` THROWS during render, taking the whole selection bar down — pinned as current behaviour, filed as objectui#8730, and it reds when that lands. The spec row is `z.array(z.unknown())`, so the read site is the whole member contract (objectui#8071).',
  },
  'object-grid.bulkActions': {
    file: 'packages/plugin-grid/src/__tests__/bulkActionMembers-8071.test.tsx',
    pins: 'Members are BARE ACTION NAMES resolved against `objectDef.actions` and PROMOTED — read off a button carrying the object action\'s own label, which is deliberately not the humanized form of the name, so a renderer treating the member as a display string could not pass. Two companions make it a reading rather than a claim: a name matching no declared action still reaches the bar BY NAME (the `registerHandler` path), and an object member — the `page:header.actions` hole (objectstack#11592) transposed onto this key — is skipped by `resolveBulkActions`\' `typeof name !== \'string\'` guard with no diagnostic at all. `selection` is declared explicitly on every row, because the grid derives multi-select from these very keys and a negative row would otherwise lose its selection UI for the reason under test. The spec row is `z.array(z.unknown())` (objectui#8071).',
  },
  'object-grid.batchActions': {
    file: 'packages/plugin-grid/src/__tests__/bulkActionsSpecKey.test.tsx',
    pins: 'Members are the SAME bare action names `bulkActions` carries — this key is the legacy alias — so what is pinned here is the PRECEDENCE the members are read through, which is where the alias can hurt: the read site is `schema.batchActions ?? schema.bulkActions`, so a populated legacy array wins over a populated canonical one (the objectui#1763 rows) and an EMPTY legacy array wins too — ⚠️ NOT because the coalesce is nullish, a reading ablation refused: `[]` is both non-nullish and truthy, so `??` and `||` are indistinguishable here and only an explicit length test would drop it. A schema half-migrated to `bulkActions` that leaves `batchActions: []` behind therefore renders NO bulk action at all — pinned with `selection` authored, so the checkboxes and the count are real and only the buttons are missing, and nothing is thrown. The same rows pin that this key\'s members drive the selection auto-enable gate (`hasBulkActions`) exactly as the canonical key\'s do. What each member RESOLVES to is `object-grid.bulkActions`\'s pin and is not restated here. Pre-existing file, promoted after being read end to end and GROWN by the empty-array and auto-enable rows, which its two non-empty fixtures could not state (objectui#8071).',
  },
  'object-grid.exportOptions': {
    file: 'packages/plugin-grid/src/__tests__/ObjectGrid.exportOptionsKeys.test.ts',
    pins: 'The member KEY SET the renderer reads off `schema.exportOptions` (and off the alias bound to it), scanned out of `ObjectGrid.tsx` with comments and string literals stripped, against the `object-grid` REGISTRATION\'s own member enumeration — which is this block\'s only statement of member shape, since the registration declares `type: \'object\'` with no `of` and the spec row is `z.unknown()`. Two directions: the registration may advertise NO member key the renderer ignores (the declaration-side form of the objectstack#11592 hole), and the reverse gap is asserted as an EXACT named set — `streaming`, read at two sites to choose server-streamed vs client-assembled export and absent from the enumeration, filed as objectui#8731 — so a second undocumented key cannot join it and landing the fix reds the row. Carries objectui#4535\'s read-subset-of-declared-type direction as before (objectui#8071).',
  },
  'object-grid.data': {
    file: 'packages/plugin-grid/src/__tests__/gridDataInputContract.test.ts',
    pins: 'The `object` arm is `ViewDataSchema` discriminated on `provider`: each of the three providers parses and the retired `api` one is refused (spec 18.1.0, objectui#12370, objectui#12971, objectui#13261, objectui#13440), none of them is an array, the declaration is one shape across both registered tags so the alias cannot drift, and it is pinned at compile time too (objectui#5090).',
  },
  'object-grid.conditionalFormatting': {
    file: 'packages/plugin-grid/src/__tests__/gridRowDecorationMembers-8071.test.tsx',
    pins: 'The members read inside ONE formatting rule, asserted on the `style` attribute of the `<tr>` the grid paints. THREE alternative predicate members with a PRECEDENCE between them — one rule carrying `condition`, `expression` and the native `field`/`operator`/`value` triple, each naming a DIFFERENT row, is decided by `condition`; drop it and `expression` decides; drop that and the triple does — so a renderer reading any two of them as equivalent is red in a specific direction rather than merely unpinned. FOUR style members, and the sharp one is a RENAME: `backgroundColor` and `borderColor` keep their authored names on the way to the DOM while `textColor` is read as the CSS `color`, so keeping the authored spelling hands React a key it silently drops — same rules, same background, the text colour gone with nothing thrown. `style` is pinned as the BASE the three colour members override rather than replace (a non-colour member of it survives alongside the override). Two rule-list facts complete it: FIRST-MATCH-WINS with no merge (the second matching rule\'s own `textColor` never lands) and a rule carrying NO predicate member is SKIPPED rather than read as always-true, with the rule after it still deciding. ⚠️ Since objectui#11533 the AUTHORED member is ONE dialect, `{ condition, style }`: `expression`, the native triple and the three top-level colour members are refused by name on `ObjectGridSchema` and the list view (`packages/types/src/__tests__/grid-list-view-conditional-formatting-11533.test.ts`), so the rows that write them pin STORED-rule reads, which the resolver keeps as compatibility arms; a last block pins the two facts side by side — the stored native rule refused at authoring and painted at render, with its respelling painting the same row. The registration is an `array` arm; the installed spec row (18.1.0, re-measured by objectui#12030, objectui#12370, objectui#12626, objectui#12873, objectui#12971, objectui#13261, objectui#13440) takes the list view\'s own `{ condition, style }` rule and refuses the native members and any other key, so the spec fixes the AUTHORED shape and the read site is the rest of the member contract, the stored-rule compatibility arms included (objectui#8071 slice 12).',
  },
  'object-grid.operations': {
    file: 'packages/plugin-grid/src/__tests__/gridOperationsMembers-8071.test.tsx',
    pins: 'The THREE members read off this block, and the fact that they do not behave alike. `update` and `delete` gate the row kebab\'s generic entries and are read INDEPENDENTLY; an authored block REPLACES the wired-callback default rather than merging under it, so `operations: {}` — and, the shape an author actually writes, `operations: { export: false }` — CLOSES both even with `onEdit`/`onDelete` wired, while omitting the key entirely opens them. Neither member is a grant: both are ANDed with the consumer\'s callback, and both are a UNION with `rowActions`\' canonical names, so `update: false` cannot close what `rowActions: [\'edit\']` opened — the reading opposite to the natural one for a key spelled like a permission block. `export` is read at a different site with the OPPOSITE default, pinned as one statement: inside a single present block, the same omission closes `update` and leaves `export` allowed. Every kebab claim is read out of an opened menu on a rendered row, because a computed prop is green against a grid that draws the entry anyway. Prior art stated rather than credited: `exportGate.test.tsx` covers the `export` member alone and the two row-CRUD suites cover the layers ANDed on top, none of them the key\'s own members (objectui#8071 slice 12).',
  },
  'object-grid.rowActions': {
    file: 'packages/plugin-grid/src/__tests__/legacyRowActionDispatch.test.tsx',
    pins: 'Members are BARE ACTION NAMES resolved against `objectDef.actions` and dispatched as real defs — read off an entry carrying the object action\'s own label, which is deliberately not the humanization of the name, plus the unresolvable name that still renders for the `registerHandler` path and the no-dead-twin row (objectui#2960). The member fact objectui#8071 slice 12 GREW this file by: TWO spellings are CANONICAL. `edit` and `delete` are tested for, fed to the same gate `operations.update`/`delete` feed, and then REMOVED from the list handed to `resolveLegacyRowActions`, so they render as the BUILT-IN entries wired to `onEdit`/`onDelete` and NOT also as generic name-dispatched ones — passing the list on unfiltered is silent and shows up only as a second Edit beside the first, dispatching a type the runner has no handler for. Asserted with a canonical and an ordinary member in the same array, each absence paired with a presence in the same opened menu, and with a NON-ARRAY value read as no members at all. Pre-existing file, GROWN by the canonical-member rows before being registered rather than credited on its strings (objectui#2960, objectui#8071 slice 12).',
  },
  'object-grid.rowColor': {
    file: 'packages/plugin-grid/src/__tests__/gridRowDecorationMembers-8071.test.tsx',
    pins: 'The two CO-REQUIRED members, asserted on the class the grid paints onto the `<tr>`: `field` names a RECORD field and `colors` is the map keyed by ITS value, so two rows of one grid take two different classes and a value the author did not declare takes none. Either member alone colours NOTHING, with the complete pair over the same data as the control that keeps both absences from reading as a dead resolver. The map is keyed by the STRINGIFIED value — a number matches the string key, and an absent field and an explicit `null` collapse onto the SAME empty-string entry, which is the only way an author can colour "not set yet"; dropping the `?? \'\'` sends `null` to the key `"null"`, which no author writes. A map VALUE is read as a colour NAME or as an already-built `bg-*` class, and anything else (a hex, a CSS colour keyword) yields no class rather than reaching the DOM as a class attribute of its own. Absence is measured as the set of emitted `bg-<hue>-<step>` tokens, not as "contains bg-", because every row carries `bg-background` unconditionally and the weaker form would be vacuous. `useRowColor.prototypeGuard.test.tsx` is NOT this pin: it calls the hook directly and never names the block, so the repo\'s own locator would refuse it and it is green against a grid that never passes the resolver to the table (objectui#8071 slice 12).',
  },
  'object-grid.pagination': {
    file: 'packages/plugin-grid/src/__tests__/gridPagerSelectionMembers-8071.test.tsx',
    pins: 'The members read off the pager, and the OBJECT\'s own presence rule beside them: `pagination !== undefined` is what enables paging, so an authored object OVERRULES a deprecated `showPagination: false` (with the no-object control beside it, where the boolean IS honoured); `pageSize` sizes the page and WINS over the deprecated flat `pageSize` when the two disagree; and `pageSizeOptions` REPLACES the built-in rows-per-page list rather than extending it — asserted by opening the real selector and comparing the offered set against the built-in control, so an author adding one larger step silently loses 10 / 20 / 50 / 100. ⚠️ The GROUPED pager is deliberately not asserted: it hard-codes its own choices and reads neither member, which is handed back as a finding rather than frozen into this pin. The spec side fixes the member NAMES (`{ pageSize, pageSizeOptions? }`) and nothing about presence, precedence or replacement, so the read site is the whole member contract (objectui#8071).',
  },
  'object-grid.searchableFields': {
    file: 'packages/plugin-grid/src/__tests__/serverSearch.test.tsx',
    pins: 'Members are FIELD NAMES that reach the fetch as `$searchFields` verbatim and IN ORDER (a deliberately non-alphabetical pair, which a single-member fixture cannot state), with the absent control beside them — a view may narrow which fields the server matches, never widen it (ADR-0061). The sharp member fact is the ARITY: the read is `searchableFields !== undefined ? length > 0 : showSearch`, so an EMPTY array is not "narrow nothing" but search OFF and the toolbar box disappears, while a NON-EMPTY array overrules a deprecated `showSearch: false` — the opposite of what half-migrated metadata expects, and silent both ways. Pre-existing file, promoted after being read end to end and GROWN by the ordering, empty-array and precedence rows; its one pre-existing row pinned forwarding alone (objectui#8071).',
  },
  'object-grid.selection': {
    file: 'packages/plugin-grid/src/__tests__/gridPagerSelectionMembers-8071.test.tsx',
    pins: 'ONE member is read — `type` — and the pin is mostly about what that means for the object around it: the read is `schema.selection?.type`, so unlike its neighbour `pagination` the OBJECT\'s presence alone does nothing, and each of the three spec values is asserted at the checkbox column (`multiple` = rows + select-all header, `single` = rows and NO header, `none` = no column). `none` is pinned as an explicit OFF that beats BOTH fallback arms — the deprecated `selectable: true` AND the auto-enable that a declared `bulkActions` would otherwise trigger — each with its own control showing the fallback winning when the member is absent. The consequence an author suffers: a grid declaring bulk actions and `selection: { type: \'none\' }` renders a bar that no selection can ever populate, with nothing thrown and no diagnostic. The DataTable-level vocabulary parity is `data-table`\'s own pin and is not restated (objectui#8071).',
  },
  'object-grid.aggregations': {
    file: 'packages/plugin-grid/src/__tests__/gridAggregationMembers-8071.test.tsx',
    pins: 'The TWO members of one roll-up entry — `field` and `type` — read at the group header the grid paints, and the fact that the six `type` values do not agree about what `field` means. `count` never reads `field` at all (it answers `rows.length`, including the rows that carry no such cell), while `count_distinct` does and skips the empties — the two are asserted on the SAME group, so the pair is a contrast rather than two numbers. The arithmetic rows are the sharp ones and all three are silent: coercion is `Number()`, so an explicit `null` cell is a real ZERO that lowers `avg` and WINS `min`, while an ABSENT cell is `NaN` and is dropped — two spellings an author reads as the same emptiness; `avg` therefore divides by the coerced list, not by the group, which is pinned as `count: 3` beside `avg: 5.50` in one header; and `min`/`max` over NO numeric cell report `0` rather than the `Infinity` a bare spread would put on screen. Two formatting rows complete it (a non-integer is padded to exactly two decimals, an integer is not), plus the key\'s own presence rule: `aggregations` without `grouping` computes and renders NOTHING, and an EMPTY array is indistinguishable from an absent key. ⚠️ The chip prints the `type` member and never the `field` member, so two same-type entries over different fields are told apart only by their values and their authored order — pinned as current behaviour, handed back as a finding rather than frozen. The registration is an `array` arm whose member shape lives only in its description, so the read site is the whole member contract (objectui#8071 slice 14).',
  },
  'object-grid.dataSource': {
    file: 'packages/plugin-grid/src/__tests__/ObjectGrid.elementDataSource.test.tsx',
    pins: 'The five members of the spec\'s `ElementDataSourceSchema` binding (`{ object, view, filter, sort, limit }`) as this block reads them, and — the half the file was GROWN by — the PRECEDENCE between the three sources one value can arrive from. The rule in one sentence: a `dataSource.*` member beats the block\'s own key, and the block\'s own key beats the view the binding named. Each member is asserted as a PAIR, once written on the binding and once supplied by the view, because either half alone is consistent with a renderer that simply takes the last writer: binding `sort` overrides an authored `schema.sort` while a VIEW\'s sort loses to it, and binding `limit` overrides an authored `pagination.pageSize` while a view\'s page size loses to it. `object` overrides an `objectName` the block authored itself, which is invisible when both objects exist. The limit row carries its own sharp half — the cap is written into a COPY of the authored `pagination` object, so a sibling `pageSizeOptions` survives; assigning `{ pageSize }` would pass every `$top` assertion and silently delete the rows-per-page list. `filter` is "additional" and AND-combines rather than replacing, a lone binding with no view passes its members through verbatim, and an unresolvable `view` renders a configuration error instead of widening the query. ⚠️ The key is INJECTED into this registration by `Registry.register` (`ELEMENT_DATA_SOURCE_INPUT`), not written by the block, so the declaration says `type: \'object\'` and `binding: \'object\'` and nothing about members at all. Pre-existing file (objectstack#6953), promoted after being read end to end and grown by the precedence rows (objectui#8071 slice 14).',
  },
  'object-grid.navigation': {
    file: 'packages/plugin-grid/src/__tests__/gridNavigationMembers-8071.test.tsx',
    pins: 'All SIX members the spec\'s strict `NavigationConfigSchema` declares — `mode`, `view`, `preventNavigation`, `openNewTab`, `size`, `width` — driven through a real row click on the real grid, where the registration names only `mode` and elides the five that decide what the click does. The precedence is the content: `preventNavigation` OUTRANKS every mode including the overlay ones (`{ mode: \'drawer\', preventNavigation: true }` draws no drawer and throws nothing, with the same config minus the flag as the live control), and `openNewTab` outranks `mode: \'page\'` AND DISCARDS `view` while doing it — the member written to choose a destination is dropped by the member written to choose a window. `view` is pinned as what it actually is, the second ARGUMENT handed to the host, with the literal `\'view\'` standing in when it is absent — one character apart in the source, entirely different things. `size` and `width` are pinned as ONE decision with three outcomes, read off the `--ov-w` the shell publishes: the deprecated `width` wins over a `size` authored beside it, a bucket name resolves through the size table, and `\'auto\'` resolves to neither and lands on the block\'s own default width. The absent-key control is that a grid with NO `navigation` still navigates, so the key\'s effect cannot be measured by deleting it. Prior art stated rather than credited: `ObjectGrid.overlayShellModes-9299` pins the four OVERLAY values of `mode` across the shell boundary and names no other member (objectui#8071 slice 14).',
  },
  'object-grid.columns': {
    file: 'packages/plugin-grid/src/__tests__/gridColumnMembers-8071.test.tsx',
    pins: 'The members of one authored column, read through the real grid at the DOM each one moves. The registration names two of them in prose (`field`, `label`, plus `width` inside an example) while `ListColumnSchema` is strict over fourteen, so the content is the eleven the description elides and the precedence between them: `label` OUTRANKS the machine-name prettifier and its absence is what prettifies; `align` is INFERRED from a numeric `type` and an authored `align` beats the inference, which is the only way to get a left-read number column; `type` OUTRANKS the name-shaped heuristic this block runs (`active` reads boolean by its SPELLING, so a column is typed by its name until the member says otherwise); `wrap` is read as a decision rather than truthiness, with `false` forwarded as authored and an absent key falling to the same clamp by a different road; `prefix` puts ANOTHER field\'s value inside this column\'s cell; `width` is pinned against the AUTO-SIZED width rather than against emptiness, because a column with no authored width still carries one. ⭐ The two ways a column VANISHES are pinned as different events: `hidden: true` is authored intent and is silent, while an unresolvable column is dropped AND reported on the console (objectui#5349) — the same empty grid, two different bugs. `field` is pinned where it decides the QUERY, as the name that reaches `$select` while the label beside it does not. Prior art stated rather than credited: `columnDeclaredSpellingOnly` (identity spelling), `column-features` (`pinned`/`summary`/`link`/`action`), `ObjectGrid.columnWrapForward`, `columnWidthInbound-6457`, `columnSortabilitySignal`, and `columnReadBoundary-6458`, which bounds this producer\'s UNDECLARED reads to the empty set by source scan. New file (objectui#8071 slice 17).',
  },
  'object-grid.filter': {
    file: 'packages/plugin-grid/src/__tests__/gridFilterInputSpelling.test.tsx',
    pins: 'The three members of one `ViewFilterRule` — `field`, `operator`, `value` — at the `$filter` the grid actually sends, plus the key-level pins the file already carried (the declared singular name, lowering to AST rather than bare rule objects, AST passthrough, and an empty array folding to no `$filter` at all). The member half is the growth: `operator` is FOLDED through the spec\'s own alias map so `eq` and `equals` are one operator and not two dialects, while an operator the spec does not know passes through VERBATIM on purpose — the wire names the author\'s typo instead of this hop guessing a repair; an omitted `value` is a SHAPE CHANGE, lowering to the 2-tuple the valueless operators need rather than a 3-tuple with a hole; and `value` decides whether the view renders AT ALL — an ARRAY comparand on a single-valued operator throws (objectui#8557) inside a render-time `useMemo`, so `SchemaErrorBoundary` replaces the whole block with an alert naming the field, with an `in` rule carrying the same array as the live control. ⚠️ WHERE that refusal lands is objectui#9050\'s open question for all thirteen such sites; this pins what ships today and endorses nothing. Pre-existing file (objectui#4041), promoted after being read end to end and grown by the member section (objectui#8071 slice 17).',
  },
  'object-grid.grouping': {
    file: 'packages/plugin-grid/src/__tests__/gridGroupingMembers-8071.test.tsx',
    pins: 'The one member `GroupingConfigSchema` declares (`fields`) and the three its strict entries declare (`field`, `order`, `collapsed`), at the group headers the grid paints AND at the projection it asks the server for. `order` sorts the headers by their RENDERED LABEL rather than by the stored value, `collapsed` is a DEFAULT that the first click inverts rather than a state, `fields` is ORDERED so the second entry nests inside the first and each level sorts on its own entry, and an unusable entry (a `null` hole, the bare-string shorthand the strict schema refuses, a blank name) is DROPPED — never coerced, never fatal — with the usable one still grouping. The query half is what keeps the screen honest: a grouped field the columns never mention is UNIONED into `$select`, because without it the server never returns it and ONE `(empty)` group holds every record (objectui#7179); the entries it groups by and the entries it projects are asserted as the same set. ⭐ THE SHARED MEMO with `columns` is pinned here, and it is what makes these two keys non-disjoint: `groupValueFormatter` derives the header labels from `schema.grouping` AND `schema.columns`, so `columns[].type: \'boolean\'` respells a grouped `"true"`/`"false"` as Yes/No. A select value\'s header LABEL comes from the object field\'s `options` only, and because `order` sorts the rendered labels the field\'s options MOVE the groups. The memo\'s former read of `columns[].options`, which `ListColumnSchema` does not declare and, being strict, REFUSES at publish, is retired (objectui#11544): a column carrying `options` beside the field\'s is pinned as not read, with a no-field-options control. New file (objectui#8071 slice 17).',
  },
  'object-grid.sort': {
    file: 'packages/plugin-grid/src/__tests__/gridArrayArmOrderby-8973.test.tsx',
    pins: 'The two members of one sort entry — `field` and `order` — across ALL THREE readers this block has for them, which is the half a declaration saying `[{ field, order }]` cannot publish. The file\'s own six-row probe table pins the fetch path: an entry missing `order` lowers to `asc` rather than the literal text `undefined` (a `400 INVALID_QUERY` at the server), an entry missing `field` is skipped rather than ordering by a column named `undefined`, an empty array carries NO `$orderby` rather than `""`, and a mixed array keeps its usable member — each with a live `"name desc"` control so the absences are readings. The growth is the other two readers: the server-side EXPORT projection spells the same member `{ field, direction }` and the header-arrow reader `parseSchemaSort` spells it `{ field, order }`. ⚠️⚠️ They do NOT agree, and the disagreement is pinned rather than repaired: `normalizeSortEntries` folds any non-`desc` order to `asc` for the wire and `parseSchemaSort` does the same for the arrow, while the export projection reads `?? \'asc\'` and passes an UNRECOGNISED direction through verbatim — one authored `{ field: \'name\', order: \'descending\' }` orders the screen ascending, draws an ascending arrow, and asks the export door for `direction: \'descending\'`. Reported as a finding; changing what that door receives is a change to a shipped request shape, not a member pin. Pre-existing file (objectui#8973), promoted after being read end to end and grown by the three-reader section (objectui#8071 slice 17).',
  },
  'object-grid.label': {
    file: 'packages/plugin-grid/src/__tests__/ObjectGrid.labelI18nLabel-10993.test.tsx',
    pins: 'The I18nLabel object arm on the grid\'s identity key: through the real `SchemaRenderer`, the `{ type, properties }` document, and the table caption `ObjectGrid` builds from `resolveI18nLabel(schema.label, displayLocale)`. With no regional locale mounted the display locale is the UI language, so a `properties.label` map paints its `zh-CN` entry under `zh` and its `en` entry under `en`, every map listing `en` FIRST so an `en` or first-entry fallback fails the `zh` row; a plain-string control renders as authored. The record-detail overlay heading, the third read, is `ObjectGrid.overlayTitleInlineLocale-9092.test.tsx`\'s pin; the manifest half (a map is not a `type-mismatch`) is `i18nLabelInputsManifest-10993.test.ts` in this directory. ⛔ Not the deprecated `title`, whose caption fallback still reads a map raw and is held to a later batch (objectui#10993).',
  },
  'object-grid.description': {
    file: 'packages/plugin-grid/src/__tests__/ObjectGrid.declaredKeys-11068.test.tsx',
    pins: 'The I18nLabel object arm on the grid\'s help-text line, published at `@objectstack/spec` 17.6.0 once the row declared it (objectui#11227): through the real `SchemaRenderer` and the `{ type, properties }` document, a `properties.description` map paints its `fr` entry under a `fr` UI language, with `en` listed FIRST so an `en` or first-entry fallback fails the row; a plain string draws as authored; and a map with no usable entry draws no strip at all, the same as an absent key, because the guard reads the RESOLVED text. Pre-existing file (objectui#11068), read end to end before being cited; the manifest half (a map is not a `type-mismatch`) is `i18nLabelInputsManifest-10993.test.ts` in this directory.',
  },
  'object-grid.emptyState': {
    file: 'packages/plugin-grid/src/__tests__/ObjectGrid.emptyStateI18nLabel-11227.test.tsx',
    pins: 'Three of the four members the spec\'s strict `EmptyStateSchema` declares (`title`, `message`, `icon`), at the empty state the grid draws in place of an empty table, through the real `SchemaRenderer` and the `{ type, properties }` document (objectui#11227). `title` and `message` are I18nLabel: a map paints its `zh-CN` entry under `zh` and its `en` entry under `en`, with `en` listed FIRST so a fallback fails the `zh` row, and the two members resolve independently (a map title beside a string message). A map with no usable entry keeps that member\'s default: the table\'s own "No results found" heading, and no message line. `icon` is a plain Lucide name, read off the same object. The render-failure signature is asserted absent on every row, because the pre-fix renderer handed a map to `DataEmptyState` as an object child, which React refuses. The string arm, the empty-search case and the not-drawn-with-rows case are `ObjectGrid.declaredKeys-11068.test.tsx`\'s rows. The fourth member, `link`, is pinned by `ObjectGrid.emptyStateLink-12270.test.tsx` in the same directory (objectui#12270). New file.',
  },
  'object-kanban.cardFields': {
    file: 'packages/plugin-kanban/src/__tests__/ObjectKanban.structuredMembersReachTheirSinks-8313.test.tsx',
    pins: 'Members are BARE FIELD NAMES, and the pin is explicit about WHICH question it answers (the objectui#8269 trap): `resolveKanbanCardFields` answers which names the AUTHOR chose — authored order preserved, and NOT filtered against the object definition, which is the one behaviour that separates the explicit list from the `highlightFields` fallback it overrides (that fallback IS filtered). Which cells a card ends up carrying is a SECOND and narrower question, measured separately at the render, because the card loop further drops a name duplicating the title and one whose value is empty. An empty array reading as omitted is the control that keeps the fallback rows from being vacuous. The spec side is `z.array(z.string())`, so it constrains the member KIND but says nothing about either read — the sinks are the whole of the member contract (objectui#8313).',
  },
  'object-kanban.columns': {
    file: 'packages/plugin-kanban/src/__tests__/objectKanbanColumnMembers-8071.test.tsx',
    pins: 'The SWIMLANE element\'s six members, each at its OWN sink and none assumed to behave like its neighbour, driven through the real renderer on a real adapter. `id` decides which records land in the lane (`groups[col.id]`) and names the heading, with an unmatched record swept into the trailing lane rather than dropped (objectui#2792) as the control. ⭐ `title` is the lane\'s accessible name and ⛔ NOT a bucketing key: it used to be a second, undeclared BUCKETING ALIAS, so renaming a lane moved records; objectui#10069 (ruling A) retired it and FLIPPED that row, so a record whose stored group value is the lane\'s TITLE is now swept into the trailing lane with a console warn. `cards` is a UNION and not a replacement — static lane cards survive the fetch, come first, and are not de-duplicated against it. `limit` is displayed beside the count and flags the lane, and ⛔ never truncates: the over-limit row asserts every card still renders, so a pin watching only the badge could not stay green under a renderer that dropped the overflow. `className` reaches that lane\'s container and no other. `collapsed` withholds that lane\'s cards while its neighbour keeps them — the member-set row only, because `columnCollapsedHonoured-9628.test.tsx` owns that member whole. The set itself is asserted as a WHITELIST: an undeclared lane member reaches no sink, with a `className` marker on the same lane in the same render as the lit control. ⚠️ The DECLARATION half is a different file and deliberately not duplicated here: `packages/types/src/__tests__/object-kanban-columns-declared-8913.test.ts` (objectui#8913/#8989) parses lane bags against both published faces, and every assertion in it is a `safeParse` — it cannot say what the board DOES with a member it admitted, which is objectui#8068\'s criterion. Read end to end before being cited. New file (objectui#8071 slice 16).',
  },
  'object-kanban.conditionalFormatting': {
    file: 'packages/plugin-kanban/src/__tests__/ObjectKanban.structuredMembersReachTheirSinks-8313.test.tsx',
    pins: 'Members are card STYLE RULES in ONE dialect since objectui#11522, the spec list view\'s `{ condition, style }`, and it reaches the sink: a rule colours the matching card and only it, a second rule aimed at the other card does the same, and the whole `style` map arrives, with the sibling card in the same render as the live non-matching control so a green cannot come from two unstyled cards agreeing. The retired native `{ field, operator, value }` and flat-colour dialects are refused by name on the types side (`packages/types/src/__tests__/kanban-conditional-formatting.test.ts`); these rows are their respellings, painting the same cards. ⛔ NOT an identity pin and not a wire pin: `ObjectKanban.tsx` never names this key at all (measured zero, against nine for `cardFields` in the same file) — it rides the `{ ...schema }` spread into `KanbanRenderer`, which forwards it to `KanbanImpl`\'s `getCardStyles`. That makes the pin load-bearing in a way the others are not: an edit replacing that spread with an explicit key list drops the key silently and nothing else in the repo would notice. The installed spec row (18.1.0, re-measured by objectui#12030, objectui#12370, objectui#12626, objectui#12873, objectui#12971, objectui#13261, objectui#13440) takes the list view\'s own `{ condition, style }` rule, so the spec fixes the authored shape and the read site is the rest of the member contract (objectui#8313).',
  },
  'object-kanban.data': {
    file: 'packages/plugin-kanban/src/__tests__/ObjectKanban.structuredMembersReachTheirSinks-8313.test.tsx',
    pins: 'Members are RECORDS, and the key is read TWICE with two different meanings — both pinned, because either read alone would misdescribe it. As a GATE it suppresses the board\'s own query entirely — asserted as zero `find` calls through a window a CONTROL row proves is long enough for a real query to land. That gate is DOUBLY guarded on the authored-node path and the pin says so, because naming one guard would be wrong: `SchemaRenderer` spreads non-metadata schema properties as props, so an authored `data` is also this component\'s `data` prop, `hasExternalData` is true, and the effect returns before `!schema.data` is reached. Removing either guard alone leaves the rows green; removing both reddens them. As a VALUE it is selected by `rawData = external || boundData || schema.data || fetchedData` and then REBUILT by `effectiveData` into cards — so ⛔ no identity claim is true of this key, unlike the two `filter` pins. What is read INSIDE a member is what the pin asserts instead: `id` (or `_id`) as the card identity, the `groupBy` field\'s value as the lane it lands in, the card-title field, and the `cardFields` cells. The spec row is `z.array(z.unknown())` — it fixes the container kind and nothing about a member (objectui#8313).',
  },
  'object-kanban.dataSource': {
    file: 'packages/plugin-kanban/src/ObjectKanban.elementDataSource.test.tsx',
    pins: 'The five members of the spec\'s `ElementDataSourceSchema` binding (`{ object, view, filter, sort, limit }`) as THIS block reads them, which is one line of this package — `OBJECT_KANBAN_DATA_SOURCE = { filter: true, sort: true, limit: \'limit\' }`, consumed by `ElementDataSourceGate`. Each member is stated with its disposition, and the five are not alike: `object` is mapped and OUTRANKS an `objectName` the board authored itself (`next[objectKey] = composed.object`, unconditional — the `??=` spelling would leave a rebound board querying the old object with the same lanes and no diagnostic); `view` supplies the baseline the others are contested against, and an unresolvable one REPORTS instead of widening the query to every record; `filter` is ADDITIONAL and AND-combines with the board\'s OWN `filter` as well as the view\'s, with the measured nesting pinned (`[\'and\', <rule list>, <rule list>]`, each source keeping its own list) and a lone source passing through verbatim; `limit` is mapped onto the block\'s `limit` with binding > block > view, asserted as a PAIR so neither branch reads as a renderer that simply takes the last writer. ⭐ `sort` was the loud one — declared by the spec, silently IGNORED by this block — until objectui#10068 flipped the row: a binding `sort` now reaches the query as `$orderby` (`convertSortToQueryParams`, the `field -> direction` map every sibling block sends) with a mapped `limit` moving in the SAME binding as the lit control, a named view\'s `sort` reaches it too and the binding\'s own `sort` beats the view\'s, cards inside a lane keep the sorted fetch order rather than being re-sorted, and an absent `sort` sends no `$orderby` as the control. `columns` is deliberately NOT mapped and the pre-existing rows say why: a board\'s `columns` are its SWIMLANES, so a view\'s field list written there would render one empty lane per field name. ⚠️ The key is INJECTED by `Registry.register` (`ELEMENT_DATA_SOURCE_INPUT`), not written by the block, so the declaration says `type: \'object\'` and nothing about members at all — the read site is the whole member contract. Pre-existing file (objectstack#6953 + objectui#4025), promoted after being read end to end and GROWN by the five disposition rows (objectui#8071 slice 16).',
  },
  'object-kanban.filter': {
    file: 'packages/plugin-kanban/src/__tests__/ObjectKanban.filterMembersReachTheWire-8176.test.tsx',
    pins: 'The `object-kanban` twin of `object-calendar.filter` above, written for this change because the board had no equivalent: the authored array reaches `$filter` BY IDENTITY, a condition on a field named `columns` (this block\'s own configuration key) stays a filter and never reaches a configuration read, both member forms pass through identically, and an unauthored `filter` arrives as `undefined` rather than as a fabricated default — the control that keeps the other three from reading as a coincidence. Same reasoning as the calendar entry: the AUTHORED member is the spec row\'s `ViewFilterRule` array (taken by reference on `@object-ui/types` since objectui#6152 round 8), and the board reads none of it, so the wire carries whatever reaches the node, the array-of-arrays form a host composes included (objectui#8176).',
  },
  'object-kanban.grouping': {
    file: 'packages/plugin-kanban/src/__tests__/ObjectKanban.structuredMembersReachTheirSinks-8313.test.tsx',
    pins: 'ONE nested position and no more: `schema.grouping?.fields?.[0]?.field` is the FALLBACK source of `swimlaneField`, and that is the entire member contract this board carries for the key. Three rows make it a reading rather than a claim — the swimlane layout appears keyed by `fields[0].field` where without the key there is none; an explicit `swimlaneField` WINS over it; and a second `fields` entry changes nothing, which is what pins the read at `[0]` rather than at "the fields list". The declared description says the rest is inert precisely so the declaration does not recommend a write the renderer cannot honour — this file is what keeps that sentence true. The spec row types the block as the list view\'s `GroupingConfigSchema`, which both `@object-ui/types` faces take by reference (objectui#11216): that fixes its SHAPE, not which position this board reads, so the read site is still the whole of what the board does with a member (objectui#8313).',
  },
  'object-kanban.navigation': {
    file: 'packages/plugin-kanban/src/__tests__/kanbanNavigationMembers-8652.test.tsx',
    pins: 'The members of the spec\'s `NavigationConfigSchema` block the board reads, each driven through a real card click on the real board and asserted on what the click DID: an ABSENT key opens a drawer (the renderer\'s own default, the lit control), `none` and `preventNavigation` open nothing with the flag outranking an overlay mode, `new_window` and `openNewTab` open the record page in a new tab with `openNewTab` outranking `page` and every overlay mode but not `none` (objectui#11168 slice 5), and `size` / `width` are one width decision (`width` wins, a bucket resolves through the size table, `auto` lands on the default). A parent view\'s click handler outranks the whole key, overlay mode included. Since objectui#11293 the `page` rows pin the navigation the description states: under a host that publishes its record navigator, `page` and a block without `mode` open the record page through it (no overlay, no new tab), with `drawer` as the lit control and a parent `onRowClick` outranking it; with no host navigator `page` opens nothing (objectui#8652, objectui#11293).',
  },
  'object-master-detail-form.cancelText': {
    file: 'packages/plugin-form/src/MasterDetailForm.i18nLabels.test.tsx',
    pins: 'The I18nLabel object arm, resolved at the read site: through the real `SchemaRenderer`, a `properties.cancelText` map under a `zh` UI renders the map\'s `zh-CN` entry on the Cancel button, with `en` listed FIRST so an `en` or first-entry fallback fails the row. Before objectui#10935 the map was a raw Button child and threw "Objects are not valid as a React child". The button renders only when the host supplies `onCancel`, so the row adds one beside the document and asserts the host handler still runs. A plain-string control and the nothing-authored control (`Cancel`) stay green, and the first row asserts the mounted documents pass `safeValidateSchema`. The manifest half (a map is not a `type-mismatch`) is `masterDetailFormI18nLabelManifest.test.ts` in this directory (objectui#10935).',
  },
  'object-master-detail-form.dataSource': {
    file: 'packages/plugin-form/src/MasterDetailForm.elementDataSource.test.tsx',
    pins: 'The per-element binding\'s members on the block that writes a parent AND its children in one batch. `object` is the only key mapped (the gate\'s default mapping), asserted at the fetch it causes, and it OUTRANKS a flat `objectName` on the same node: `next[objectKey] = composed.object` is unconditional, and the `??=` spelling would keep a rebound form on the old parent with no diagnostic. ⭐ The row only this block can make: the bound object reaches the DETAIL half. `deriveDetail` picks a child\'s FK by the parent object\'s name and the atomic batch names the parent on its first leg, measured on one child object that carries a lookup to BOTH candidate parents, so the derived FK and the parent leg together say which name won. `view` / `filter` / `sort` / `limit` are NOT mapped: a resolving view adds no parent collection query, an unresolvable one REPORTS, and in `edit` mode each child line read stays `{ $filter: { FK: recordId }, $top: 500 }` whatever the binding carries. ⚠️ Unmapped is not unread: beside a named `view` the gate merges the binding\'s `filter` with the view\'s, so a malformed one WITHHOLDS the whole form behind the malformed-filter notice, with a well-formed one as that row\'s control. A binding-free form is the control for the negatives. `dataSource` is absent from `ComponentPropsMap[\'object-master-detail-form\']` (it is the injected `ELEMENT_DATA_SOURCE_INPUT`), so nothing declared constrains the precedence. Pre-existing file (objectstack#7121), promoted after being read end to end and GROWN by five rows, four facts and a control (objectui#8071 slice 18).',
  },
  'object-master-detail-form.details': {
    file: 'packages/plugin-form/src/__tests__/masterDetailDetailsMembers-8071.test.tsx',
    pins: 'Members are detail-collection OBJECTS (`MasterDetailDetailConfig`), and unlike this block\'s parent keys the read site is THIS block: `MasterDetailForm` is the key\'s only reader. Each member renders as its own section in AUTHORED order, headed by `title` (fallback `Line Items`), with `columns` reaching the line grid in authored order. ⭐ The sharp row: four members reach the grid through ONE hand-written object under the grid\'s camelCase keys (objectui#11610): `minRows`, `maxRows` and `addLabel` by the same name, and `amountField` RENAMED to the grid\'s `totalField` (the CHILD column summed; the detail\'s own `totalField`, the PARENT field, is not forwarded), beside `columns` and the DERIVED `sortField` (objectui#11070 round 9 retired the detail\'s `sortField` member; row 2c pins that a written one is read by nothing). That object is pinned as a SORTED KEY SET of exactly six, with two off-list members (one in the grid\'s own spelling, `allowAdd`) asserted not forwarded and an all-empty control beside it. `inlineMode: \'form\'` makes a list whose Add opens the full form (labelled `Add` when unset), and in grid mode `formFields` wider than `columns` offers the row form; each arm is the other\'s control. `childObject` and `relationshipField` address the atomic batch (each line a create on the child, linked by `{ $ref: 0 }`) and the edit-mode read (`{ $filter: { FK: recordId }, $top: 500 }` per collection). `totalField` receives the sum of the lines\' `amountField` on the PARENT leg, and a collection without one puts nothing there. With `{ childObject }` alone the FK and the columns are DERIVED from the child object, the one member behaviour the spec\'s description promises, and the batch writes the derived FK. `details: []` is the non-vacuity control: no section, no grid, a one-leg batch. The line grid is the REAL `LineItemsField`, wrapped only to record the props it is handed. Since `@objectstack/spec` 17.6.0 (objectstack-ai/objectstack#21215) the spec row is an array of CLOSED entries — `childObject` required, `columns` the spec\'s inline grid column, an undeclared member key refused by name — and `@object-ui/types` takes that row by reference, so both published faces give the spec\'s verdict on an entry (`packages/types/src/__tests__/object-master-detail-form-details-entry-11396.test.ts`). `MasterDetailDetailConfig` is DERIVED from that entry (objectui#11396) and held `Equal` to it at compile time in the pinned file, minus ONE key, `sortField`, which this block does not read (row 2c): a fork through 17.6.0, closed by `@objectstack/spec` 17.7.0, whose entry refuses an authored `sortField` with its retired-key message (objectstack-ai/objectstack#21589, objectui#11717). The registration declares `of: \'object\'`, derived from the now single-kind member contract. A declaration fixes an entry\'s SHAPE, not what this block DOES with a member, so the read site is still the whole member contract. New file (objectui#8071 slice 18).',
  },
  'object-master-detail-form.fields': {
    file: 'packages/plugin-form/src/__tests__/topLevelFieldsWarnCoverage-8847.test.tsx',
    pins: 'Members are bare PARENT field names drawn in AUTHORED order, against a no-`fields` control whose order is the object\'s. A name the parent does not declare is dropped rather than drawn as an untyped stub, measured with a DETAIL column name because one node here declares two field vocabularies, while the line grid keeps that column. `{ name }` is the same member as the bare name. The two pre-existing rows carry the sharpest member fact: the spec `FormFieldSchema` object that is legal in `sections[].fields` resolves to no name here, draws the named route-1 warning (objectui#8738, objectui#8847) and does not render, with a bare name as the firing control. ⚠️ Pinned as BEHAVIOUR and handed back: the key bounds what is DRAWN, not what the parent leg WRITES. A seeded field it does not list is still written, while the registration calls this key the parent pool for "the submitted set". The intersection with `sections` belongs to the `object-master-detail-form.sections` pin and is not re-asserted. `MasterDetailForm` reads none of this itself: the `parentSchema` memo copies the key onto an `object-form`-shaped node rendered through a DIRECTLY imported `<ObjectForm>`, the hand-written carrier that is why the pin is taken at this block. The spec row is `z.array(z.unknown())` and the registration declares no `of`, so the read site is the whole member contract. Pre-existing file (objectui#8847), promoted after being read end to end and GROWN by five rows (objectui#8071 slice 18).',
  },
  'object-master-detail-form.initialData': {
    file: 'packages/plugin-form/src/__tests__/masterDetailInitialMembers-8071.test.tsx',
    pins: 'Members are PARENT FIELD NAMES and each member value is that control\'s opening value \u2014 pinned in ONE file with `initialValues`, because this block\'s own registration declares them a pair ("Alternate spelling of `initialValues` the renderer also reads", with new schemas told to prefer `initialValues`) and a pair pinned apart leaves the PRECEDENCE stated nowhere. The precedence is PER MEMBER since objectui#9760: one shared `resolveInitialRecord(schema)` merges `{ ...initialValues, ...initialData }`, so with both authored a member `initialData` says nothing about keeps its `initialValues` value, and an EMPTY `initialData` contributes nothing rather than blanking the parent form. It used to be whole-object (`schema.initialData || schema.initialValues`, where `||` tests the object and `{}` is truthy); objectui#8071 wrote pins only, so it recorded that and handed the defect back, and the maintainer ruling on objectui#9760 repaired it \u2014 the two rows were FLIPPED there, \u26d4 not deleted. \u2b50 The two rows no sibling pin can make are the block\'s own: the seed reaches the PARENT LEG of the atomic batch and nothing else (a member naming a detail column seeds no child row and the posted batch still carries exactly one operation), and in `edit` mode with a `recordId` the fetched record REPLACES both keys wholesale, so a member the record omits opens empty rather than falling back to the seed. Neither key has a read site in this block at all: `MasterDetailForm`\'s `parentSchema` memo copies them key by key onto an `object-form`-shaped object rendered through a DIRECTLY imported `<ObjectForm>` \u2014 no `SchemaRenderer`, no registry lookup \u2014 which is exactly why the pin is taken here, since that hand-written map can drop a key while every declaration still reads correct (the failure `object-form.sections` records twice, objectui#9779 / objectui#9834). A no-keys row renders the same controls empty as the non-vacuity control. Both keys are registered `type: \'object\'` and typed `Record<string, any>`, so every object parses on both declared sides and the read site is the whole member contract. New file (objectui#8071 slice 15).',
  },
  'object-master-detail-form.initialValues': {
    file: 'packages/plugin-form/src/__tests__/masterDetailInitialMembers-8071.test.tsx',
    pins: 'The other half of this block\'s declared alternate-spelling pair, pinned in the same file and the same rows \u2014 see `object-master-detail-form.initialData` above. This is the spelling the registration tells authors to PREFER and the one that loses outright whenever the other is authored, which is the reason the pair is pinned together (objectui#8071 slice 15).',
  },
  'object-master-detail-form.sections': {
    file: 'packages/plugin-form/src/__tests__/masterDetailSectionMembers-8071.test.tsx',
    pins: 'Members are section OBJECTS shaping the PARENT half only \u2014 a member\'s `fields` are parent field names drawn in the member\'s AUTHORED order (FLIPPED with objectui#10475, which moved `SimpleObjectForm` off a name filter that let the OBJECT\'s field order win), and the block\'s `details` collections keep their own columns through every row. A member that resolves to NO parent field is dropped WHOLE, heading included, measured with a DETAIL column name as the member because that is the mistake this composition invites: one node declares two field vocabularies and only one of them is this key\'s. \u2b50 The sharp row, and it now AGREES with the block\'s own registration. `ObjectForm` builds the parent pool from `schema.fields` FIRST and a section filters against that pool, so authoring both INTERSECTS them \u2014 a section member outside `fields` does not render, and a section whose every member is outside it disappears heading and all. \u26a0 It used to record this as a DIVERGENCE, because the registration declared `fields` "Ignored when `sections` is given \u2014 sections carry their own field lists", and to record the loss as having NO DIAGNOSTIC; objectui#8071 slice 15 handed both back as a finding rather than acting on them, because acting changes either the renderer or the declaration and that card wrote pins only. objectui#9884 ruled it, and the DECLARATION was the wrong half: one `SimpleObjectForm` renders this block\'s parent half and `object-form` alike, and the three sibling `fields` registrations (`object-form`, `form`, `embeddable-form`) declare the key as the field selection with no such exemption, so honouring it would have falsified three declarations to satisfy one \u2014 on a pool that also feeds create defaults, the seed merge and the values a submit carries. The sentence was corrected and the SILENCE closed instead: `warnSectionMemberExcludedByFields` names every such drop, once per section-and-member pair, and is measured BEFORE `applyFieldPerms` so a perms-gated field is never reported as an authoring mistake. \u26d4 So the diagnostic is part of what this row pins now, and slice 15\'s two DOM assertions stand unchanged beside it \u2014 the rendered outcome did not move. Rows 3b, 3c and 3d carry the last-member case (with a counterfactual beside it), the firing control, and the leg keeping the warning off the DIFFERENT silence row 2 owns. The key has no read site in this block: `MasterDetailForm`\'s `parentSchema` memo copies it onto an `object-form`-shaped object rendered through a DIRECTLY imported `<ObjectForm>`, the same hand-written carrier whose dropped keys `object-form.sections` records twice (objectui#9779 / objectui#9834) \u2014 which is why the pin is taken here rather than delegated. \u26d4 Deliberately NOT re-asserted, because they are owned next door by `objectFormSectionMembers-8071.test.tsx` and duplicating them buys nothing: `collapsed` vs `collapsible`, the `name`-alone heading, the untitled trailing bucket and the `description` blurb; the `simple` / `tabbed` presentation routing is owned by `masterDetailFormTypeVocabulary.test.tsx`. A no-sections row is the non-vacuity control. Both declared sides are unconstrained (bare `type: \'array\'` with no `of`; `sections?: any[]`), so the read site is the whole member contract. New file (objectui#8071 slice 15).',
  },
  'object-master-detail-form.submitText': {
    file: 'packages/plugin-form/src/MasterDetailForm.i18nLabels.test.tsx',
    pins: 'The I18nLabel object arm on the Save button — see `object-master-detail-form.cancelText` for the harness. A `properties.submitText` map under a `zh` UI renders its `zh-CN` entry, where the raw read threw "Objects are not valid as a React child" before objectui#10935. The controls are a plain string rendered as authored and, with nothing authored, the English defaults (`Create` in create mode, `Save` in edit mode) (objectui#10935).',
  },
  'object-master-detail-form.title': {
    file: 'packages/plugin-form/src/MasterDetailForm.i18nLabels.test.tsx',
    pins: 'The I18nLabel object arm where `title` is displayed: the built-in toast after an EDIT save, which shows only when the host supplies no `onSuccess`. A `properties.title` map under a `zh` UI toasts `采购单 saved`, where the raw read toasted "[object Object] saved" before objectui#10935. The controls are a plain string (`PO saved`) and, with nothing authored, `Saved`. A compile-time row in the same file holds `MasterDetailFormSchema[\'title\']` (and the other two labels) equal to `I18nLabel | undefined` (objectui#10935).',
  },
  'object-metric.aggregate': {
    file: 'packages/plugin-dashboard/src/__tests__/objectMetricQueryMembers-8071.test.tsx',
    pins: 'A three-member options bag whose members are read TWICE — once into the adapter call, once back out of the response. `field`/`function`/`groupBy` become `ds.aggregate(object, { field, function, groupBy, filter })` with `groupBy` OPTIONAL and defaulting to `\'_all\'` (one bucket) and an authored value outranking it; the bag is asserted AS A WHOLE so a member added to or dropped from the call is red in either direction. The readback is the half that has no second chance: `function: \'count\'` sums `<field>_count` across EVERY returned row while any other function reads the FIRST row\'s `<field>_<function>`, and the two arms run on the SAME two-row response so only a readback reading both members can answer 120 on one and 7 on the other — a `field`/`function` that reached the query but not the readback paints 0 over a response that carried the right number. `<field>` unsuffixed is pinned as the chain\'s second limb. The key\'s ABSENCE is a member semantic in its own right and is the file\'s non-vacuity floor: with no `aggregate` the query VERB changes to `find()` and the value becomes the row count. Driven through the registered block, not the bare widget. New file (objectui#8071 slice 8).',
  },
  'object-metric.compareTo': {
    file: 'packages/plugin-dashboard/src/__tests__/ObjectMetricWidget.compareTo.test.tsx',
    pins: 'The `{ kind, dimension? }` member set under objectstack#5011\'s converged shape: `kind` alone chooses BOTH the comparison window and the trend label, pinned on a QUARTER-scoped filter so the two admitted values disagree about each (`previousYear` = the same quarter one year back and "vs last year"; `previousPeriod` = the quarter before and "vs last quarter") — a year-scoped fixture would have let a `previousYear` that fell through to the other branch pass. `dimension` is CARRIED but inert on this inline path (it addresses a dataset time dimension the executor resolves), asserted by the query\'s filter keys being unchanged by it. An absent `compareTo` runs a single pass and paints no trend, which is the control that keeps the other rows from reading as a coincidence. Pre-existing file (objectui#3337), promoted here after being read end to end; objectui#8071 slice 8 added the row that mounts `type: \'object-metric\'` through `SchemaRenderer`, so the claim that the block\'s gate forwards this key untouched is asserted rather than assumed.',
  },
  'object-metric.dataSource': {
    file: 'packages/plugin-dashboard/src/ObjectMetric.elementDataSource.test.tsx',
    pins: 'The per-element binding\'s members as a WHITELIST in both directions. Acting: `object` is what gets aggregated, and a named `view`\'s own `filter` becomes the metric\'s scope — with an unresolvable `view` REPORTING instead of aggregating the whole object, which for a metric is the quiet failure (one number, no rows, nothing to notice). Not acting: the same view fixture declares `columns`, `sort` and `pagination`, and the aggregate options bag is asserted whole to keep all three OUT — `OBJECT_METRIC_DATA_SOURCE` names only `filter`, because a metric is one aggregated number with no projection, ordering or page for the rest to act on. A metric with NO binding behaving exactly as before is the control. Pre-existing file (objectstack#6953), promoted here after being read end to end; objectui#8071 slice 8 added the whole-bag row, without which the pin would have been satisfied by a mapping that forwarded everything.',
  },
  'object-metric.description': {
    file: 'packages/plugin-dashboard/src/__tests__/ObjectMetric.i18nLabel-10993.test.tsx',
    pins: 'The I18nLabel object arm as the sub-caption under the value — see `object-metric.label` for the harness. A `properties.description` map paints its `zh-CN` entry on the tile under `zh` and its `en` entry under `en`; a plain-string control renders as authored (objectui#10993).',
  },
  'object-metric.drillDown': {
    file: 'packages/plugin-dashboard/src/__tests__/objectMetricDrillDownMembers-8071.test.tsx',
    pins: 'The click-through config\'s member set, read through the registered block on a LIVE drawer. `enabled` is `!== false`, not truthiness, and all four arms (absent, `{}`, `true`, `false`) are pinned against each other, so a "simplification" to `!!config.enabled` — which would silently disable every `{}` config — is red; and it is not sufficient on its own, because without an object name AND a data source the tile stays unclickable rather than opening a list it cannot fetch. `target` chooses the panel SHAPE (`\'dialog\'` = centred modal, anything else the edge-anchored sheet), each arm the other\'s control. `title` OUTRANKS the tile\'s own `title` and `label`, with the chain below it (`title`, then `label`, then the literal "Details") pinned as its fallback. `report` selects the drawer BODY by its own SHAPE — an `objectName`-bearing (or array-`columns`) report goes to a `spec-report` body while anything else falls through to the inline record list, and whether the record list is fetched at all is the observable that separates them. The invariant the key hangs off is pinned too: the drilled list is scoped by the METRIC\'s resolved filter with macros already substituted — the registration\'s own promise that the number and the records behind it agree, and a drawer listing every row of the object is the quiet failure it exists to stop. LIMIT, stated and deliberately NOT asserted: `filter` and `mode` have no read site on this block — a metric has no click event for `${event.*}` to resolve against, and its registration promises the drilled list agrees with the number — so they are left to objectui#8970\'s open question rather than frozen into the pin, because an assertion that a member is dead has to be deleted before the gap can be closed. The other three the shared component honours (`columns`, `maxRows`, `target: \'navigate\'`) were dead here for the same reason and are now LIVE: objectui#8970 routed this block through `DrillDownDrawer`, and they are pinned on their effects in `ObjectMetricWidget.drillRoutedToSharedDrawer-8970.test.tsx`. The spec row is `z.unknown()`, so the read site is the whole member contract. New file (objectui#8071 slice 9).',
  },
  'object-metric.filter': {
    file: 'packages/plugin-dashboard/src/__tests__/objectMetricQueryMembers-8071.test.tsx',
    pins: 'No named member set — the renderer never inspects the predicate — so the member shape is the SPELLING it arrives under, and there are two, chosen by an adapter capability the author cannot see: FLAT under its own name inside the aggregate options bag, and WRAPPED as `$filter` on the no-`aggregate()` `find()` fallback. Collapsing them into one drops the predicate on whichever path lost and the tile counts every row — the same defect `element:number.filter` was pinned for (slice 7) on a different renderer. Two further halves: placeholders are resolved BEFORE the query (an authored `{current_quarter_start}` reaches the adapter as a real date, and a macro surviving onto the wire is a literal nobody matches), and the key is read BY VALUE rather than by identity (`JSON.stringify` memo) — a deep-equal rebuild by a re-rendering parent must NOT re-probe while a changed comparand MUST and carries the new predicate, each arm the other\'s control against a dependency "simplified" to the raw object. New file (objectui#8071 slice 8).',
  },
  'object-metric.label': {
    file: 'packages/plugin-dashboard/src/__tests__/ObjectMetric.i18nLabel-10993.test.tsx',
    pins: 'The I18nLabel object arm on the tile\'s heading, through the real `SchemaRenderer` and the registered `ObjectMetricBlock`, in the `{ type, properties }` form, every map listing `en` FIRST so an `en` or first-entry fallback fails the `zh` row. A `properties.label` map paints its `zh-CN` entry on the tile under `zh` and its `en` entry under `en`, and heads the drill-down panel when no `title` is authored; a plain-string control renders as authored. `MetricWidget` resolves it with `pickLocalized` against the UI language; `ObjectMetricWidget.i18nLabel.test.tsx` pins the same resolution on the widget mounted directly. The manifest half (a map is not a `type-mismatch`) is `i18nLabelInputsManifest-10993.test.ts` in this directory (objectui#10993).',
  },
  'object-metric.title': {
    file: 'packages/plugin-dashboard/src/__tests__/ObjectMetric.i18nLabel-10993.test.tsx',
    pins: 'The I18nLabel object arm as the drill-down panel\'s heading — see `object-metric.label` for the harness. The tile is clicked open and a `properties.title` map heads the panel with its `zh-CN` entry under `zh` and its `en` entry under `en`; a plain-string control heads it as authored (objectui#10993).',
  },
  'object-metric.trend': {
    file: 'packages/plugin-dashboard/src/__tests__/objectMetricTrendMembers-8071.test.tsx',
    pins: 'The static badge\'s three members, each pinned on an observable only that member can move, driven through the registered block. `value` is painted as a PERCENTAGE — the `%` is the badge\'s own, asserted beside a metric whose `format` and `suffix` shape the NUMBER differently. `direction` chooses the glyph and is pinned as a SET (`up` / `down` / `neutral`, plus the OMITTED arm, which still paints the value and draws no glyph at all), so "renders an up arrow" cannot pass on a renderer that draws one unconditionally; an off-list member is asserted not to reach the badge, and a tile with neither `trend` nor `description` draws no badge row — the file\'s non-vacuity floor. The two rows with real semantics to get wrong: the tile-level `description` OUTRANKS `trend.label` in the one caption slot they share, so a tile that authors both silently loses the trend\'s own words; and a `compareTo`-DERIVED trend REPLACES the authored badge outright (`derivedTrend ?? trend`) rather than merging with it. That override is pinned against a no-`compareTo` control on the SAME schema, where 120-vs-100 derives +20% up while the authored badge says 99% down, so neither arm can pass by painting the other\'s numbers — which is what makes the registration\'s own sentence ("Use `compareTo` instead when the trend should be computed from data") true rather than advisory. The spec row is `z.unknown()`, so the read site is the whole member contract. New file (objectui#8071 slice 9).',
  },
  // objectui#11168 slice 3 — `object-map`, newly judged once this file loads
  // `@object-ui/plugin-map`. Six keys share ONE new file, every row through the
  // real `SchemaRenderer` and this package's own registration with MapLibre
  // stubbed; `dataSource` PROMOTES a pre-existing file, read end to end first.
  'object-map.map': {
    file: 'packages/plugin-map/src/__tests__/objectMapInputs-11168.test.tsx',
    pins: 'Members are FIELD NAMES and the camera, each on the observable only it moves: `latitudeField` / `longitudeField` plot one marker per record, with a binding that names no number-holding field plotting none (the control); `locationField` reads a `"lat,lng"` string, a `{ lat, lng }` object and a `[lat, lng]` pair; `titleField` and `descriptionField` name the popup\'s heading and line after a marker click, a different `titleField` changing the heading; `zoom` and `center` (`[latitude, longitude]`) ARE the initial camera, where an absent camera fits the markers (`bounds`). `style` is pinned with `mapStyle`, both ways: the node\'s `mapStyle` is read BEFORE `map.style`, as the spec row\'s own describe says ("Read before `map.style`") and the seat ruled (option A) — both written draws `mapStyle`, either alone draws itself, neither draws the demo tiles. The spec block fixes names and value kinds; how each is used is the read site (objectui#11168 slice 3).',
  },
  'object-map.data': {
    file: 'packages/plugin-map/src/__tests__/objectMapInputs-11168.test.tsx',
    pins: 'Members are the `{ provider, … }` configurations, asserted on markers plotted AND queries issued: `value` plots its `items` and queries nothing, `object` queries THAT object and plots what it returns, and `api` plots nothing and queries nothing, as the description says. The ladder POSITION is pinned too: a `data` configuration wins over `staticData` and `objectName` on the same node. The bare-array spelling is objectui#8348\'s pin (`ObjectMap.dataArmSpecRow-8348.test.tsx`) and is not re-asserted (objectui#11168 slice 3).',
  },
  'object-map.staticData': {
    file: 'packages/plugin-map/src/__tests__/objectMapInputs-11168.test.tsx',
    pins: 'Members are RECORDS, plotted by the `map` block\'s fields: a record without readable coordinates is skipped, never placed at an invented point. The POSITION claim is pinned against a live control: a map carrying `staticData` and `objectName` plots the inline rows and never queries, while the same node without the rows does query. The spec row is `z.array(z.unknown())`, so the read site is the whole member contract (objectui#11168 slice 3).',
  },
  'object-map.filter': {
    file: 'packages/plugin-map/src/__tests__/objectMapInputs-11168.test.tsx',
    pins: 'Members are `{ field, operator, value }` rules: a rule narrows the inline records plotted, `operator` is read (`not_equals` plots the complement of `equals`), and on the object query the rule reaches `$filter` with its members unchanged, against a control with no `filter` whose query carries no `$filter`. The binding\'s filter AND-ing is `object-map.dataSource`\'s pin (objectui#11168 slice 3).',
  },
  'object-map.sort': {
    file: 'packages/plugin-map/src/__tests__/objectMapInputs-11168.test.tsx',
    pins: 'Members are `{ field, order }`, and those two keys are all the map reads inside one: each member lowers to `field -> direction` on `$orderby`, in AUTHORED order, and an omitted `order` reads ascending rather than dropping the member; with no `sort` the query carries no ordering (the control). ⛔ Not an identity pin: the shared `convertSortToQueryParams` sink builds a new map (objectui#11168 slice 3).',
  },
  'object-map.dataSource': {
    file: 'packages/plugin-map/src/ObjectMap.elementDataSource.test.tsx',
    pins: 'The per-element binding\'s members as this block reads them, through the REAL `ElementDataSourceGate` + renderer pair: `object` is the object queried, a named `view`\'s `filter` / `sort` reach the fetch as `$filter` / `$orderby`, the binding\'s own `filter` AND-combines with the view\'s rather than replacing it, a `sort` member missing `order` reads ascending (objectui#4022), an unresolvable `view` reports instead of fetching the whole object, and an authored `limit` never reaches `$top`, which stays the platform ceiling (`OBJECT_MAP_DATA_SOURCE` maps `filter` and `sort` only). A map with no binding behaves exactly as before one existed. ⚠️ The key is INJECTED by `Registry.register` (`ELEMENT_DATA_SOURCE_INPUT`), so the declaration says nothing about members. Pre-existing file (objectstack#7121), promoted after being read end to end (objectui#11168 slice 3).',
  },
  'object-map.navigation': {
    file: 'packages/plugin-map/src/__tests__/objectMapInputs-11168.test.tsx',
    pins: 'The members of the spec\'s `NavigationConfigSchema` block the map reads, each driven through a real marker click: `drawer` (the LIT CONTROL), `modal` and `popover` open the marker\'s record; `split` opens NOTHING, because the map hands the split shell no main panel; `none` and `preventNavigation` open nothing, the flag outranking an overlay mode; `new_window` and `openNewTab` open `/{objectName}/record/{id}` in a new tab, `openNewTab` outranking `drawer` but NOT `none`; `size` / `width` are one width decision (`width` wins, a bucket resolves, `auto` lands where an unsized drawer does); and a parent view\'s click handler outranks the whole key. An ABSENT key opens nothing, with the host\'s record navigator mounted and without. `page`, and a block without `mode`, are pinned both ways: under a host that publishes its record navigator (`RelatedRecordActionsContext`) they open the record page of the map\'s `objectName` through it, with no overlay and no tab, and `drawer` stays the lit control there; with no host navigator, or on a map that names no `objectName`, they open nothing (objectui#11168 slice 3, objectui#11293).',
  },
  // objectui#11168 slice 3 — `object-tree`, newly judged once this file loads
  // `@object-ui/plugin-tree`. ONE file pins the five structured keys, every row
  // through the real `SchemaRenderer` and this package's own registration, with
  // a control per positive row; each claim below names its rows.
  'object-tree.tree': {
    file: 'packages/plugin-tree/src/__tests__/objectTreeInputs-11168.test.tsx',
    pins: 'Members are FIELD NAMES the tree draws by, each on the observable only it moves: `parentField` nests a record one level under the record its value names (a field holding no parent id leaves every record a root — the control), `labelField` picks the text of the first column with an absent member reading `name`, `fields` adds one flat column per member after the label (header and cell, against a label-only control), and `defaultExpandedDepth: 0` draws roots only where an absent member opens every level. Measured and pinned, not endorsed: a FLAT key of the same name on the node outranks the member (`getTreeConfig` reads `schema.parentField ?? tree.parentField`); the spec row does not declare the flat keys and the registration does not publish them. The spec block is a strict four-key object, so it fixes the NAMES but nothing about how each is used (objectui#11168 slice 3).',
  },
  'object-tree.data': {
    file: 'packages/plugin-tree/src/__tests__/objectTreeInputs-11168.test.tsx',
    pins: 'Members are the `{ provider, … }` configurations, each asserted on the rows drawn AND the query issued: `{ provider: \'value\', items }` draws those records and queries nothing, `{ provider: \'object\', object }` queries THAT object and draws what it returns, and `api` and `schema` — both accepted by the spec row — draw nothing and query nothing, which is what the description says. The ladder POSITION is pinned too: a `data` configuration wins over `staticData` and over `objectName` on the same node. The bare-array spelling is objectui#8348\'s pin (`ObjectTree.dataArmSpecRow-8348.test.tsx`) and is not re-asserted (objectui#11168 slice 3).',
  },
  'object-tree.staticData': {
    file: 'packages/plugin-tree/src/__tests__/objectTreeInputs-11168.test.tsx',
    pins: 'Members are RECORDS, and the keys read inside one are the `tree` block\'s fields: each record is placed under the record its parent-id value names, and one naming no record is drawn as a ROOT rather than dropped. The POSITION claim the description makes is pinned against a live control: a tree carrying both `staticData` and `objectName` draws the inline rows and never queries, while the same node without the rows does query, so "never queries" cannot read as a harness that cannot. The spec row is `z.array(z.unknown())`, so the read site is the whole member contract (objectui#11168 slice 3).',
  },
  'object-tree.filter': {
    file: 'packages/plugin-tree/src/__tests__/objectTreeInputs-11168.test.tsx',
    pins: 'Members are `{ field, operator, value }` rules: a rule narrows the inline records drawn, `operator` is read (`not_equals` draws the complement of `equals`), a record whose parent the filter removed is drawn as a ROOT rather than dropped (the description says so), and on the object query the rule reaches `$filter` with its members unchanged — against a control with no `filter`, where the query carries no `$filter` and every inline row is drawn. Context-token resolution is shared machinery and is pinned where it lives, not here (objectui#11168 slice 3).',
  },
  'object-tree.navigation': {
    file: 'packages/plugin-tree/src/__tests__/objectTreeInputs-11168.test.tsx',
    pins: 'The members of the spec\'s `NavigationConfigSchema` block the tree reads, each driven through a real row click and asserted on what the click DID: `drawer` (the LIT CONTROL), `modal` and `popover` open the row\'s record, and `split` opens it BESIDE the tree, which stays drawn (unlike the timeline, the tree hands the split shell its own view); `none` and `preventNavigation` open nothing, the flag outranking an overlay mode; `new_window` and `openNewTab` open `/{objectName}/record/{id}` in a new tab, `openNewTab` outranking `page` and `drawer` but NOT `none`, which is read first; and `size` / `width` are one width decision (`width` wins, a bucket resolves, `auto` lands where an unsized drawer does). A parent view\'s click handler outranks the whole key. An ABSENT key opens nothing, with the host\'s record navigator mounted and without. `page`, and a block without `mode`, are pinned both ways: under a host that publishes its record navigator (`RelatedRecordActionsContext`) they open a record page through it, with no overlay and no tab, and `drawer` stays the lit control there; with no host navigator, or on a tree that names neither `data.object` nor `objectName` (inline rows alone), they open nothing. The object opened is `data.object` when `data` is the object provider, both with no `objectName` and when both are written (the rows\' object wins), and the node\'s `objectName` otherwise (objectui#11168 slice 3, objectui#11293).',
  },
  // objectui#11168 slice 4 — `object-gantt`, newly judged once this file loads
  // `@object-ui/plugin-gantt`. Seven keys share ONE new file, every row through
  // the real `SchemaRenderer`, this package's own registration and the real
  // `GanttView`; `data`, `staticData` and `dataSource` PROMOTE pre-existing
  // files, each read end to end first.
  'object-gantt.gantt': {
    file: 'packages/plugin-gantt/src/__tests__/objectGanttInputs-11168.test.tsx',
    pins: 'Members are FIELD NAMES, each on the observable only it moves: `titleField` titles a task\'s row and `startDateField` / `endDateField` give its start and end, with a block naming other fields moving all three (the control). The block is taken WHOLE: flat `startDateField` / `endDateField` / `titleField` composed on the node beside it are ignored. The spec side is pinned with it: a block missing `titleField` is refused at `gantt.titleField`, and `percentageField` — which this key\'s description used to name, and nothing reads — is refused by name, while the description no longer names it. `exportFileName` is pinned with `object-gantt.label`; `colorField`, `dependenciesField` and `viewMode` keep their narrow pins (`ObjectGantt.colorFieldLadder-7243.test.tsx`, `ObjectGantt.dependencyAlias.test.tsx`, `ObjectGantt.viewmode.test.tsx`) and are not re-asserted (objectui#11168 slice 4).',
  },
  'object-gantt.data': {
    file: 'packages/plugin-gantt/src/__tests__/recordSourceInputs-10394.test.tsx',
    pins: 'Members are the `{ provider, … }` configurations, asserted through the real `SchemaRenderer` on the rows charted AND the query issued: `{ provider: \'value\', items }` charts those rows and queries nothing, `{ provider: \'object\', object }` queries THAT object and never `objectName`, and `{ provider: \'api\', read }` charts what its request returns and queries the adapter not at all. The ladder POSITION is pinned too: a `data` configuration wins over `staticData` and `objectName`, and a bare array under `data` is not a record source (`staticData` beside it is charted). ⚠️ The spec row also accepts `{ provider: \'schema\', schemaId }`, which the description does not name and this file does not pin: measured by objectui#11168 slice 4, it queries `objectName` (and, with none, an object with no name), so it is reported there as a finding rather than pinned as behaviour. Pre-existing file (objectui#10394), promoted after being read end to end (objectui#11168 slice 4).',
  },
  'object-gantt.staticData': {
    file: 'packages/plugin-gantt/src/__tests__/recordSourceInputs-10394.test.tsx',
    pins: 'Members are RECORDS, charted through the real `SchemaRenderer` by the `gantt` block\'s fields. The POSITION claim the description makes is pinned against a live control: a gantt carrying `staticData` and `objectName` charts the inline rows and never queries, while the same node with `objectName` alone does query; and a `data` configuration beside `staticData` wins. The spec row is `z.array(z.unknown())`, so the read site is the whole member contract. Pre-existing file (objectui#10394), promoted after being read end to end (objectui#11168 slice 4).',
  },
  'object-gantt.filter': {
    file: 'packages/plugin-gantt/src/__tests__/objectGanttInputs-11168.test.tsx',
    pins: 'Members are `{ field, operator, value }` rules: a rule narrows the inline rows charted, `operator` is read (`not_equals` charts the complement of `equals`), and on the object query the rule reaches `$filter` with its members unchanged, against a control with no `filter` whose query carries no `$filter`. The binding\'s filter AND-ing is `object-gantt.dataSource`\'s pin, and the context-token resolution is shared machinery pinned where it lives (objectui#11168 slice 4).',
  },
  'object-gantt.sort': {
    file: 'packages/plugin-gantt/src/__tests__/objectGanttInputs-11168.test.tsx',
    pins: 'Members are `{ field, order }`, and those two keys are all the gantt reads inside one: each member lowers to `field -> direction` on `$orderby`, in AUTHORED order, and an omitted `order` reads ascending rather than dropping the member; the same members order inline rows; with no `sort` the query carries no ordering (the control). ⛔ Not an identity pin: the shared `convertSortToQueryParams` sink builds a new map (objectui#11168 slice 4).',
  },
  'object-gantt.dataSource': {
    file: 'packages/plugin-gantt/src/ObjectGantt.elementDataSource.test.tsx',
    pins: 'The per-element binding\'s members as this block reads them, through the REAL `ElementDataSourceGate` + renderer pair: `object` is the object queried, a named `view`\'s `filter` / `sort` reach the fetch as `$filter` / `$orderby`, the binding\'s own `filter` AND-combines with the view\'s rather than replacing it, a `sort` member missing `order` reads ascending (objectui#4022), an unresolvable `view` reports instead of fetching the whole object, and an authored `limit` never reaches `$top`, which stays the platform ceiling (`OBJECT_GANTT_DATA_SOURCE` maps `filter` and `sort` only). A gantt with no binding behaves exactly as before one existed. ⚠️ The key is INJECTED by `Registry.register` (`ELEMENT_DATA_SOURCE_INPUT`), so the declaration says nothing about members. Pre-existing file (objectstack#7121), promoted after being read end to end (objectui#11168 slice 4).',
  },
  'object-gantt.navigation': {
    file: 'packages/plugin-gantt/src/__tests__/objectGanttInputs-11168.test.tsx',
    pins: 'The members of the spec\'s `NavigationConfigSchema` block the gantt reads, each driven through a real click on a task\'s open button and asserted on what the click DID: an ABSENT key opens the task\'s record in a drawer, writable (the renderer\'s own default, the lit control); `drawer`, `modal` and `popover` open it in that overlay, and `split` opens it BESIDE the chart, which stays drawn; `none` and `preventNavigation` open nothing, the flag outranking an overlay mode; `page` and a block without `mode` push the record page in the same tab, and `new_window` and `openNewTab` open it in a new tab, `openNewTab` outranking `page` and `drawer` but NOT `none`; `size` / `width` are one width decision (`width` wins, a bucket resolves, `auto` lands where an unsized drawer does). The object is `data.object` when `data` is the object provider and no `objectName` is written, and on inline rows that name no object every mode opens nothing, the default drawer included. Under a host that publishes its record navigator (`RelatedRecordActionsContext`), `drawer` stays the lit control and `page`, a mode-less block and an absent key behave exactly as without one: `openRecord` is never called, because the gantt hands the hook its own `onNavigate`. Measured, not endorsed: off the object\'s own route the derived address is the current one with `/OBJECT/record/ID` appended, host or not (objectui#11168 slice 4, objectui#11293).',
  },
  'object-gantt.holidays': {
    file: 'packages/plugin-gantt/src/__tests__/objectGanttInputs-11168.test.tsx',
    pins: 'Members are ISO `yyyy-mm-dd` DATES, each a non-working day of the working calendar: auto-schedule moves a dependent task past a listed date (a Saturday on its own, without `skipWeekends`; a Monday together with it), and the day view folds each listed date\'s column out of its axis, while an empty list folds nothing (the control). The spec row is `z.array(z.string())`, which is the member kind the input declares (`of: \'string\'`) (objectui#11168 slice 4).',
  },
  'object-gantt.markers': {
    file: 'packages/plugin-gantt/src/__tests__/objectGanttInputs-11168.test.tsx',
    pins: 'Members are `{ date, label?, color? }` objects, each on the observable only it moves: `date` places a vertical line, `label` is the text drawn against it (and its accessible name), and `color` paints it; an omitted `color` paints the theme\'s primary colour and an omitted `label` draws a bare line; a date outside the chart\'s range draws none, and with no `markers` there is none (the control). The spec row is `z.array(z.unknown())`, so the read site is the whole member contract, and the input declares no member kind (objectui#11168 slice 4).',
  },
  'object-gantt.label': {
    file: 'packages/plugin-gantt/src/__tests__/objectGanttInputs-11168.test.tsx',
    pins: 'The `object` arm is the inline locale map `{ en, "zh-CN", … }`, whose members are locale entries: the exported PNG file is named by the display locale\'s entry (`zh-CN` for a zh-CN audience, `en` for an en one), read off the real `GanttView` export\'s download anchor. The `string` arm names the file as written, a `label` written on the node itself reads the same as one in the bag, and the chain is pinned link by link: `gantt.exportFileName` outranks it, and it outranks the object\'s label, then `objectName`. The chart draws it nowhere else (objectui#11168 slice 4).',
  },
  // objectui#11168 slice 5 — `object-timeline`, newly judged once this file
  // loads `@object-ui/plugin-timeline`. Six keys share ONE new file, every row
  // through the real `SchemaRenderer` and this package's own registration;
  // `navigation` is booking (c), the objectui#8654 pin, and `dataSource`
  // PROMOTES a pre-existing file, each read end to end first.
  'object-timeline.timeline': {
    file: 'packages/plugin-timeline/src/__tests__/objectTimelineInputs-11168.test.tsx',
    pins: 'Members are FIELD NAMES, each on the observable only it moves, on entries composed from records: `startDateField` dates an entry, `endDateField` prints the end after that date, and `titleField` titles it, with a block naming other fields moving them (the control); `groupByField` names the field whose value heads each group, and without it entries group into date buckets; `colorField` paints the marker with the option colour the named field declares for the record\'s value, or with the value itself when it is a colour literal, and without it no colour is painted. Each member outranks the flat key of the same binding (composed on the node, since the authored node cannot carry one), and `titleField` / `startDateField` outrank `mapping`\'s `title` / `date`. `scale` sets the gantt axis unit on authored rows (`week` against the renderer\'s own unit without it), which is the only place it is read (objectui#11168 slice 5).',
  },
  'object-timeline.data': {
    file: 'packages/plugin-timeline/src/__tests__/objectTimelineInputs-11168.test.tsx',
    pins: 'Members are RECORDS, each composed into an entry through the `timeline` bindings (title and date asserted), drawn with no `objectName` at all and, beside one, never querying it. The POSITION claims the description makes are pinned against live controls: it is read ahead of a `bind` path (the same bind alone draws its own rows), and `items` beside it wins. `filter` beside it narrows nothing and queries nothing (objectui#11168 slice 5).',
  },
  'object-timeline.items': {
    file: 'packages/plugin-timeline/src/__tests__/objectTimelineInputs-11168.test.tsx',
    pins: 'Members are ENTRIES, drawn as written: a feed entry\'s own title and description are drawn, and the `timeline` field bindings, `mapping` and `descriptionField` beside it do not apply; it is read ahead of `objectName`, which is never queried, and under `variant: "gantt"` a member is a row whose bars are drawn. The page validator accepts a timeline on `items` alone on both tags, where it used to raise `missing-required-prop` (objectui#11168 slice 5).',
  },
  'object-timeline.mapping': {
    file: 'packages/plugin-timeline/src/__tests__/objectTimelineInputs-11168.test.tsx',
    pins: 'Members `title`, `date`, `description` and `variant` are FIELD NAMES: `title` and `date` title and date an entry where no `timeline` block names those bindings, and outrank the flat keys of the same bindings (composed on the node); `description` outranks `descriptionField`; `variant` names the field whose value picks the marker colour, with the record\'s own `variant` field read without it. On the vertical rail a colour `timeline.colorField` resolves outranks that marker colour (objectui#11168 slice 5).',
  },
  'object-timeline.filter': {
    file: 'packages/plugin-timeline/src/__tests__/objectTimelineInputs-11168.test.tsx',
    pins: 'Members are `{ field, operator, value }` rules: a rule reaches `$filter` with its members unchanged, against a control with no `filter` whose query carries no `$filter`, and a `{current_user_id}` token in `value` is resolved to the signed-in user before the query. Beside `data` the key narrows nothing: the records are drawn whole and nothing is queried. The binding\'s filter AND-ing is `object-timeline.dataSource`\'s pin (objectui#11168 slice 5).',
  },
  'object-timeline.sort': {
    file: 'packages/plugin-timeline/src/__tests__/objectTimelineInputs-11168.test.tsx',
    pins: 'Members are `{ field, order }`: each lowers to `field -> direction` on `$orderby`, in AUTHORED order, an omitted `order` reading ascending; with no `sort` the query carries no ordering (the control). The key orders the QUERY only: the rail draws the fetched entries by start date whatever the order, measured with an adapter answering latest-first (objectui#11168 slice 5).',
  },
  'object-timeline.dataSource': {
    file: 'packages/plugin-timeline/src/ObjectTimeline.elementDataSource.test.tsx',
    pins: 'The per-element binding\'s members as this block reads them, through the REAL `ElementDataSourceGate` + renderer pair: `object` is the object queried when the node names none, a named `view`\'s `filter`, `sort` and `pagination.pageSize` reach the fetch as `$filter`, `$orderby` and `$top`, the binding\'s own `filter` AND-combines with the view\'s rather than replacing it while its `sort` and `limit` override the view\'s, the block\'s own `filter` AND-combines with both, an unresolvable `view` reports instead of fetching, and a timeline with no binding queries `objectName` with no `$filter` / `$orderby` and a `$top` of 100. Pre-existing file (objectstack#7121, objectstack#7137), promoted after being read end to end (objectui#11168 slice 5).',
  },
  'object-timeline.navigation': {
    file: 'packages/plugin-timeline/src/__tests__/timelineNavigationMembers-8654.test.tsx',
    pins: 'The members of the spec\'s `NavigationConfigSchema` block the timeline reads, each driven through a real entry click on the real `ObjectTimeline` and asserted on what the click DID: `drawer` (the LIT CONTROL), `modal` and `popover` open the entry\'s record, and `split` opens NOTHING, because the timeline hands the split shell no main panel; an ABSENT key opens nothing (this renderer supplies no drawer default), with a host record navigator mounted or not; `none` and `preventNavigation` open nothing with the flag outranking an overlay mode; `new_window` and `openNewTab` open the record page in a new tab, `openNewTab` outranking `page` and every overlay mode but not `none`; `size` / `width` are one width decision. A parent view\'s click handler outranks the whole key. Under a host that publishes its record navigator, `page` and a block without `mode` open the record page through it, with no host they open nothing. On a timeline that names no `objectName`, with `drawer` as that block\'s lit control, `page` and a block without `mode` open nothing even under the host, and `new_window` / `openNewTab` open a tab at the entry\'s `id` alone (its `_id`, else `undefined`), not the record page (slice 5 round 2). Booking (c) of objectui#11168: pre-existing file (objectui#8654), registered once slice 5 made the block judged.',
  },
  'page:accordion.items': {
    file: 'packages/components/src/__tests__/pageAccordionItemMembers-8071.test.tsx',
    pins: 'Which member of one panel definition becomes which part of the rendered accordion — the four `PageAccordionItem` members (`label`, `icon`, `collapsed`, `children`) asserted as a SET through the real renderer, which nothing did before: `label` becomes the trigger\'s accessible name and `children` the panel BODY, asserted against each other so a renderer painting the wrong one cannot pass. `collapsed` is the reading with real semantics to get wrong and it is strictly `=== false`: `collapsed: false` OPENS a panel while `collapsed: true` AND an omitted `collapsed` both leave it shut — the omitted-key arm is the control an "obvious" edit to `!it.collapsed` breaks, and a no-opener fixture keeps the two shut rows from passing on a renderer that opens nothing. The single/multiple split is pinned on the SAME items so only `allowMultiple` varies: single mode takes `defaultOpen[0]` and drops later openers, multiple mode opens them all without opening panels that never asked. `icon` is covered narrowly on purpose — `page-accordion-icon.test.tsx` (objectui#4721) is its pin and is not re-litigated. New file (objectui#8071 slice 7).',
  },
  'page:card.title': {
    file: 'apps/console/src/__tests__/component-input-union-specimens.test.ts',
    pins: 'The `object` arm is the inline translation map, with a non-matching control that must still be reported (objectui#3832).',
  },
  'page:header.actions': {
    file: 'packages/components/src/__tests__/page-header-action-ids.test.tsx',
    pins: 'THE card\'s own key. The members are ACTION IDS, not `ActionDef` objects: the same action metadata is authored twice — once as ids, once as inline objects — and the two renders are compared, with the object-shape render as a live non-empty control so an id-side green cannot come from two empty headers agreeing. Covers placement, `requiredPermissions`, `visible` and `order` (objectui#6252, objectstack#11592).',
  },
  'page:header.subtitle': {
    file: 'apps/console/src/__tests__/component-input-union-specimens.test.ts',
    pins: 'The `object` arm is the inline translation map, with a non-matching control (objectui#3832).',
  },
  'page:header.title': {
    file: 'apps/console/src/__tests__/component-input-union-specimens.test.ts',
    pins: 'The `object` arm is the inline translation map, with a non-matching control (objectui#3832).',
  },
  'page:tabs.items': {
    file: 'packages/components/src/__tests__/pageTabsItemMembers-8071.test.tsx',
    pins: 'The SIX members of one tab definition (`label`, `value`, `icon`, `count`, `visibleWhen`, `children`) mapped to the six different parts of the strip they each become, driven through the real renderer — the mapping as a set, which none of the five pre-existing `page:tabs` suites asserts (each pins one member, so none would fail if `count` and `value` swapped roles). `label` becomes the trigger name and `children` the PANEL, with the inactive tab\'s body asserted absent since Radix renders only the active one. `value` is pinned BEHAVIOURALLY through `defaultTab` — the host key app-shell restores `?tab=` with — so selecting a tab by its authored value proves the member is the tab\'s identity without reaching into Radix\'s generated ids; both fallback arms follow, an absent `value` and an EMPTY-STRING one each becoming the positional `tab-INDEX`, which is what separates the real read from a bare `typeof value === \'string\'`. `count` is gated on `Number(count) > 0`, NOT on presence: an authored `count: 0` paints no badge, with a positive count on the same strip as its control. `icon` and `count` are asserted per-item against a neighbour declaring neither, so neither can be strip-wide. `visibleWhen` is covered narrowly — `page-tabs-visibility.test.tsx` is its pin. New file (objectui#8071 slice 7).',
  },
  'record:activity.types': {
    file: 'packages/plugin-detail/src/renderers/__tests__/recordActivityFeed.test.ts',
    pins: 'The allow-list\'s MEMBERS, asserted on `applyFeedConfig` — the call `record-activity.tsx` makes on every render — rather than through a DOM: each entry must name a `FeedItemType` the spec declares (the vocabulary is read from `@objectstack/spec`, never re-typed), a recognised list narrows the timeline to exactly those kinds, and the three ways a list can fail to name anything are kept APART from "no filter at all" (objectui#5841): `types: []`, an all-unrecognised list, and a non-array `types: \'comment\'` each render an EMPTY timeline, while an omitted `types` renders every kind. A mixed list keeps the recognised members and drops the rest. Both diagnostic channels are asserted in both directions with controls that a well-formed filter stays silent — including the objectui#5877 channel for a declared kind no producer emits, whose populations are derived from the producers rather than hand-listed. Pre-existing file, promoted to a pin here after being read end to end (objectui#8071 slice 6).',
  },
  'record:alert.action': {
    file: 'packages/plugin-detail/src/renderers/__tests__/recordAlertActionMembers-8071.test.tsx',
    pins: 'The CTA member object `{ actionName, label?, variant? }`, read through the real renderer with only `useMetadataItem` doubled. `actionName` is a REFERENCE resolved against the object metadata `actions[]`, so a name resolving to nothing renders NO button rather than an inert one — controlled by emptying `actions[]`, and by declaring a second action to show the named one is what dispatches. `label` OVERRIDES the resolved `ActionDef.label`, falls back to it and then to the action NAME, and accepts an inline translation map resolved to the session language (controlled against the same map under a second language). `variant` reaches the button\'s paint and OUTRANKS the severity-derived default, pinned on the discriminating case where the two disagree — an `error` banner with an authored `variant` (objectui#8071 slice 6).',
  },
  'record:alert.body': {
    file: 'apps/console/src/__tests__/component-input-union-specimens.test.ts',
    pins: 'The `object` arm is the inline translation map, with a non-matching control (objectui#3832).',
  },
  'record:alert.title': {
    file: 'apps/console/src/__tests__/component-input-union-specimens.test.ts',
    pins: 'The `object` arm is the inline translation map, with a non-matching control (objectui#3832).',
  },
  'record:alert.visible': {
    file: 'packages/plugin-detail/src/renderers/__tests__/record-alert.celEnvelope.test.tsx',
    pins: 'The `object` arm is the CEL predicate envelope `{ dialect: \'cel\', source }` and nothing else, driven through the REAL renderer mounted under the real `SchemaRenderer` — which is the only mount that can see this key\'s defect, because the envelope used to be flattened to a bare string one layer ABOVE the renderer and a normalizer-return assertion passed throughout (objectui#9100). Both members carry a verdict: `dialect` selects the ENGINE (`cel` reaches `@objectstack/formula`, where the stdlib call `has()` resolves; anything else falls to the legacy JS path, where it is not a function), and `source` is the predicate itself, asserted on three rows that differ in one field plus a fourth with the field ABSENT. ⚠️ Every row is asserted on the HIDDEN case: this call site is fail-soft, so a predicate that cannot be evaluated renders the banner and a shown-only suite cannot fail. The bare-string arm is pinned in the same file as the other half of the card\'s own ablation, with the two arms required to AGREE on every row, so a regression cannot pass by repairing one — and group A holds the paired controls (no predicate at all; a constant envelope in both directions) that keep a hidden verdict from reading as one of this renderer\'s four other `return null` paths.',
  },
  'record:chatter.feed': {
    file: 'packages/plugin-detail/src/renderers/__tests__/recordChatterFeedMembers-8071.test.tsx',
    pins: 'The nested activity-feed config\'s MEMBERS, and the fact that authoring the object REPLACES rather than merges. `record-chatter.tsx` composes `{ position, collapsible, feed: DEFAULTS, ...schema }` — a shallow spread — so an authored `feed` displaces the renderer\'s three defaults wholesale and every member not restated falls back to `RecordActivityTimeline`\'s own default. Those defaults are NOT uniform, which is the trap this pin exists for and is asserted per member: `showCommentInput` is `!== false` (ON when absent) while `enableReactions` and `enableThreading` are `?? false` (OFF), so `feed: {}` silently takes reactions and threading down while leaving the composer up. Each of the three carries its own observable — composer placeholder, the `Add reaction` affordance, and whether a reply is pulled out of the ROOT row list — each with the absent-`feed` control (objectui#8071 slice 6).',
  },
  'record:details.dataSource': {
    file: 'packages/plugin-detail/src/renderers/__tests__/recordBinding.appPage-12294.test.tsx',
    pins: 'The per-element binding\'s members as a ONE-RECORD block reads them (objectui#12294), through the REAL registration and `SchemaRenderer` on an `app` page with no record context, asserted at the bound row\'s field value and option label it draws. `object` names the object read; `filter` reaches the read (lowered by `ElementDataSourceGate`, matched by content); `sort` picks the FIRST row and reaches the read as `$orderby`, with a two-row set stored out of order as its control; `limit` is NOT the read\'s cap: one row is always asked for (`$top: 1`), because the first row of the authored cap and of a one-row read are the same row; `view` is resolved by the gate, and an unresolvable one draws the configuration panel and reads no row. Zero rows and a refused read draw the block\'s no-record state; a failed read is reported in the block\'s place. ⚠️ The key is INJECTED by `Registry.register` (`ELEMENT_DATA_SOURCE_INPUT`), not written by the block, so the declaration lists the five members generically and this pin carries which of them THIS block reads. The record-page half (unbound = the page record; bound on a record page = the bound row, kept out of the page\'s inline-edit session and highlight registry) and the data-invalidation bus are pinned in `recordBinding.recordPageAndBus-12294.test.tsx`.',
  },
  'record:details.emptyState': {
    file: 'packages/plugin-detail/src/renderers/__tests__/recordBinding.emptyState-12932.test.tsx',
    pins: 'The members of the spec\'s `EmptyStateSchema` (by reference on this block\'s row, objectstack#24266) as a BOUND record block draws them (objectui#12932), through the REAL registration and `SchemaRenderer` on an `app` page, with the key in the `properties` bag: with a `dataSource` binding whose read answers no row, `title` and `message` are drawn in the block\'s place, and a read refused as forbidden draws them too. Its controls: with no `emptyState` the block keeps its own default ("Record not found"); a bound row draws the row; a failed read draws the error panel; an unbound block on a record page draws the page\'s record and, with no record, its own default. On `record:details` the same file pins a `title` left out (the heading reads "Record not found"), a `title` as an inline locale map (its `en` entry under the display locale) and `link` (drawn through the shared `EmptyStateLink`); `icon` reaches `resolveIcon`, the grid\'s own resolver.',
  },
  'record:details.fields': {
    file: 'packages/plugin-detail/src/__tests__/recordDetailsInputs.spec-parity.test.ts',
    pins: 'Members are BARE NAMES: the spec rejects the entry-object spelling on its value, the description is asserted non-empty first and then required to teach no entry shape, and the renderer\'s more tolerant read is recorded as unexercised drift rather than a second contract.',
  },
  'record:details.hideFields': {
    file: 'packages/plugin-detail/src/__tests__/recordDetailsInputs.spec-parity.test.ts',
    pins: 'Members are bare names — the object spelling is rejected on its VALUE (a full parse, not a strip), and the description may not teach `{` (objectui#3808).',
  },
  'record:details.redactFields': {
    file: 'packages/plugin-detail/src/renderers/__tests__/record-details.unresolvedIdentityFailClosed-9054.test.tsx',
    pins: 'Members are field NAMES folded out of the authored `fields` AND every `sections[].fields` — the fold\'s two consumers, each with its own leg — through the real `DetailView` / `DetailSection` inside a real record context, asserted on rendered VALUES: a redacted member\'s value never paints while a resolvable, un-redacted sibling\'s does (the live control in the same render). An entry the fold cannot NAME is dropped rather than kept (fail closed, objectui#9054), the legacy `{ fieldName }` spelling is resolvable and not over-dropped, and with neither fold key set nothing moves. Pre-existing file, promoted to a member pin by objectui#8649, which published the key.',
  },
  'record:details.requiredPermissions': {
    file: 'packages/plugin-detail/src/renderers/__tests__/record-blocks.requiredPermissions-gate.test.tsx',
    pins: 'Members are ADR-0066 CAPABILITY names and the block needs ALL of them, driven through the real renderer under a REAL stock `MePermissionsProvider` (not a mocked `usePermissions`, which cannot discriminate the two reading paths): an unheld capability and an unrecognised one each put the insufficient-permissions notice in place of the block, a held one renders it, an EMPTY array and an ABSENT key are no gate at all, and the discriminating row is a PARTIAL grant on a two-entry array — gated only when the members are read as `.every` over the WHOLE array. Two discriminators pin that a member is a capability and not an object action (`allowRead` on the object does not open the gate; the enum member `manage` is gated rather than resolved to the read bit), and the role-based `PermissionProvider` pins the unreported-capabilities fail-open. One file runs every row against all three record blocks (objectui#10155); promoted to a member pin by objectui#8649, which published the key.',
  },
  'record:details.sections': {
    file: 'packages/plugin-detail/src/__tests__/recordDetailsInputs.spec-parity.test.ts',
    pins: 'Members are OBJECTS: every spec member key must be discoverable from the description, the retired section-id spelling must be ruled out by name, and the three renderer-only keys the spec refuses (`title`, `showBorder`, `hideEmpty`) may not be taught — filtered through the spec at runtime so a stale prohibition drops out on its own (objectui#3807).',
  },
  'record:discussion.feed': {
    file: 'packages/plugin-detail/src/renderers/__tests__/recordChatterFeedMembers-8071.test.tsx',
    pins: 'The same key on the same renderer under its other registered name — `record:chatter` and `record:discussion` are one `RecordChatterRenderer` sharing `CHATTER_INPUTS`, so both rows point at the one file, which runs every case against BOTH names. See `record:chatter.feed` for what it constrains (objectui#8071 slice 6).',
  },
  'record:highlights.dataSource': {
    file: 'packages/plugin-detail/src/renderers/__tests__/recordBinding.appPage-12294.test.tsx',
    pins: 'The per-element binding\'s members as a ONE-RECORD block reads them (objectui#12294), through the REAL registration and `SchemaRenderer` on an `app` page with no record context, asserted at the bound row\'s field value it draws. `object` names the object read; `filter` reaches the read (lowered by `ElementDataSourceGate`, matched by content); `sort` picks the FIRST row and reaches the read as `$orderby`, with a two-row set stored out of order as its control; `limit` is NOT the read\'s cap: one row is always asked for (`$top: 1`), because the first row of the authored cap and of a one-row read are the same row; `view` is resolved by the gate, and an unresolvable one draws the configuration panel and reads no row. Zero rows and a refused read draw the block\'s no-record state; a failed read is reported in the block\'s place. ⚠️ The key is INJECTED by `Registry.register` (`ELEMENT_DATA_SOURCE_INPUT`), not written by the block, so the declaration lists the five members generically and this pin carries which of them THIS block reads. The record-page half (unbound = the page record; bound on a record page = the bound row, kept out of the page\'s inline-edit session and highlight registry) and the data-invalidation bus are pinned in `recordBinding.recordPageAndBus-12294.test.tsx`.',
  },
  'record:highlights.emptyState': {
    file: 'packages/plugin-detail/src/renderers/__tests__/recordBinding.emptyState-12932.test.tsx',
    pins: 'The members of the spec\'s `EmptyStateSchema` (by reference on this block\'s row, objectstack#24266) as a BOUND record block draws them (objectui#12932), through the REAL registration and `SchemaRenderer` on an `app` page, with the key in the `properties` bag: with a `dataSource` binding whose read answers no row, `title` and `message` are drawn in the block\'s place, and a read refused as forbidden draws them too. Its controls: with no `emptyState` the block keeps its own default (nothing); a bound row draws the row; a failed read draws the error panel; an unbound block on a record page draws the page\'s record and, with no record, its own default. On `record:details` the same file pins a `title` left out (the heading reads "Record not found"), a `title` as an inline locale map (its `en` entry under the display locale) and `link` (drawn through the shared `EmptyStateLink`); `icon` reaches `resolveIcon`, the grid\'s own resolver.',
  },
  'record:highlights.fields': {
    file: 'packages/plugin-detail/src/__tests__/recordHighlightsInputs.spec-parity.test.ts',
    pins: 'Members are objects carrying `readonly` PER ENTRY — asserted to be per-entry rather than top-level, and every spec entry key must be discoverable from the `fields` description (objectui#3407).',
  },
  'record:highlights.redactFields': {
    file: 'packages/plugin-detail/src/renderers/__tests__/record-highlights.fieldSecurity-8649.test.tsx',
    pins: 'Members are field NAMES matched EXACTLY, read through the real renderer and asserted on which chips paint their value: a named member removes exactly that chip, a member naming a field the strip does not show removes nothing (the control), the field\'s LABEL and a case variant remove nothing, and two members remove two chips. The same file pins `enforceFieldSecurity` beside it — a denied field leaves no chip only when the key is `true`, with the key-absent and string-spelling rows as controls. New file (objectui#8649).',
  },
  'record:highlights.requiredPermissions': {
    file: 'packages/plugin-detail/src/renderers/__tests__/record-blocks.requiredPermissions-gate.test.tsx',
    pins: 'Members are ADR-0066 CAPABILITY names and the block needs ALL of them, driven through the real renderer under a REAL stock `MePermissionsProvider` (not a mocked `usePermissions`, which cannot discriminate the two reading paths): an unheld capability and an unrecognised one each put the insufficient-permissions notice in place of the block, a held one renders it, an EMPTY array and an ABSENT key are no gate at all, and the discriminating row is a PARTIAL grant on a two-entry array — gated only when the members are read as `.every` over the WHOLE array. Two discriminators pin that a member is a capability and not an object action (`allowRead` on the object does not open the gate; the enum member `manage` is gated rather than resolved to the read bit), and the role-based `PermissionProvider` pins the unreported-capabilities fail-open. One file runs every row against all three record blocks (objectui#10155); promoted to a member pin by objectui#8649, which published the key.',
  },
  'record:line_items.columns': {
    file: 'packages/plugin-form/src/__tests__/lineItemsDeclaredInputs-11536.test.tsx',
    pins: 'Members are inline grid column objects, driven through the real `SchemaRenderer` in the `{ type, properties }` form and asserted on the drawn grid and on the batch Save sends. Each member is one column in AUTHORED order, headed by its `label` or, without one, by its `name`. A member draws exactly what it declares: the panel hands `columns` to the grid through the field-security pass only, with no hydration from the child object, so the same value is a `number` cell under `type: \'number\'` and a text cell under a typeless member. `defaultHidden` keeps a member out of the drawn columns while `required` outranks it and marks the header. `name` is the field the cell edits, and Save writes the edit under it. The spec row is `InlineGridColumnSchema`; the registration declares a bare array, so the read site is the whole member contract (objectui#11536).',
  },
  'record:line_items.dataSource': {
    file: 'packages/plugin-form/src/__tests__/lineItemsDeclaredInputs-11536.test.tsx',
    pins: 'The per-element binding\'s members as this block reads them through `RECORD_LINE_ITEMS_DATA_SOURCE`, asserted at the query the adapter receives. `object` lands on `childObject` and OUTRANKS an authored one. A named `view` contributes its filter (ANDed BEHIND the parent scope), its sort and its page size; an unresolvable `view` REPORTS and loads nothing. The panel\'s own `sort` / `limit` outrank the view\'s, the binding\'s own outrank the panel\'s, and the binding\'s `filter` is ANDed with the panel\'s with the parent scope first. A view\'s `columns` are NOT read: the grid keeps the authored columns. The key is INJECTED by `Registry.register` (`ELEMENT_DATA_SOURCE_INPUT`) and is absent from `ComponentPropsMap[\'record:line_items\']`, so the per-block half is what this pin carries; `LineItemsPanel.elementDataSource.test.tsx` in the same package holds the older top-level-form rows (objectui#11536).',
  },
  'record:line_items.filter': {
    file: 'packages/plugin-form/src/__tests__/lineItemsDeclaredInputs-11536.test.tsx',
    pins: 'Members are spec `ViewFilterRule` objects `{ field, operator, value }`, authored in the node\'s `properties` bag and asserted at the query: they reach `$filter` in order as `[field, operator, value]` triples in ONE group ANDed BEHIND the parent relationship condition, with the spec operator word unchanged (the adapter lowers it). A member naming the relationship field itself does not replace the parent scope, and an empty list is no criterion (the query stays the parent scope object). The registration declares `of: \'object\'`, the contract\'s single member kind (objectui#11536).',
  },
  'record:line_items.sort': {
    file: 'packages/plugin-form/src/__tests__/lineItemsDeclaredInputs-11536.test.tsx',
    pins: 'Members are `{ field, order }` objects, authored in the node\'s `properties` bag and asserted at the query: they reach `$orderby` in AUTHORED order; a member with no `field` is dropped while its siblings survive, an `order` other than `desc` reads ascending, and a list with no usable member sends no `$orderby` at all. The registration declares `of: \'object\'`, the contract\'s single member kind (objectui#11536).',
  },
  'record:path.stages': {
    file: 'packages/plugin-detail/src/renderers/__tests__/recordPathStagesMembers-8071.test.tsx',
    pins: 'The stage member set `{ value, label, terminal? }`, read through the real renderer. `value` is stage IDENTITY — compared against the record\'s `statusField` to choose the current stage, controlled by moving the RECORD rather than the array, by an unmatched value leaving NO stage current, and by a record carrying some stage\'s LABEL still matching nothing. `label` is the rendered text and the `value` behind it never appears. `terminal` OUTRANKS the `WON_TOKENS`/`LOST_TOKENS` heuristic, pinned only on fixtures where the member CONTRADICTS the heuristic and each paired with the identical stage minus `terminal` to show which way the heuristic was pointing, plus an unclassified control. Deliberately the DESKTOP row only: `record-path.crossRowClassification.test.tsx` owns the cross-row agreement invariant, which is a different claim (objectui#8071 slice 6). The `label` member is an `I18nLabel`: its locale-map arm, resolved before the stages are classified or rendered, is pinned through the real `SchemaRenderer` under `zh` and `en` by `record-path.stageLabelI18nLabel-10993.test.tsx` (objectui#10993).',
  },
  'record:quick_actions.dataSource': {
    file: 'packages/plugin-detail/src/renderers/__tests__/recordBinding.appPage-12294.test.tsx',
    pins: 'The per-element binding\'s members as a ONE-RECORD block reads them (objectui#12294), through the REAL registration and `SchemaRenderer` on an `app` page with no record context, asserted at the record id a declared action runs against. `object` names the object read; `filter` reaches the read (lowered by `ElementDataSourceGate`, matched by content); `sort` picks the FIRST row and reaches the read as `$orderby`, with a two-row set stored out of order as its control; `limit` is NOT the read\'s cap: one row is always asked for (`$top: 1`), because the first row of the authored cap and of a one-row read are the same row; `view` is resolved by the gate, and an unresolvable one draws the configuration panel and reads no row. Zero rows and a refused read draw the block\'s no-record state; a failed read is reported in the block\'s place. ⚠️ The key is INJECTED by `Registry.register` (`ELEMENT_DATA_SOURCE_INPUT`), not written by the block, so the declaration lists the five members generically and this pin carries which of them THIS block reads. The record-page half (unbound = the page record; bound on a record page = the bound row, kept out of the page\'s inline-edit session and highlight registry) and the data-invalidation bus are pinned in `recordBinding.recordPageAndBus-12294.test.tsx`.',
  },
  'record:quick_actions.emptyState': {
    file: 'packages/plugin-detail/src/renderers/__tests__/recordBinding.emptyState-12932.test.tsx',
    pins: 'The members of the spec\'s `EmptyStateSchema` (by reference on this block\'s row, objectstack#24266) as a BOUND record block draws them (objectui#12932), through the REAL registration and `SchemaRenderer` on an `app` page, with the key in the `properties` bag: with a `dataSource` binding whose read answers no row, `title` and `message` are drawn in the block\'s place, and a read refused as forbidden draws them too. Its controls: with no `emptyState` the block keeps its own default (no button on a runtime view); a bound row draws the row; a failed read draws the error panel; an unbound block on a record page draws the page\'s record and, with no record, its own default. On `record:details` the same file pins a `title` left out (the heading reads "Record not found"), a `title` as an inline locale map (its `en` entry under the display locale) and `link` (drawn through the shared `EmptyStateLink`); `icon` reaches `resolveIcon`, the grid\'s own resolver.',
  },
  'record:quick_actions.actionNames': {
    file: 'packages/plugin-detail/src/__tests__/recordQuickActionsInputs.actionNamesFallback.test.tsx',
    pins: 'Members are action-id STRINGS resolved against the object\'s own `actions` through the real renderer: with no `actionNames` (and no host `actions`) the metadata layer is NEVER queried and the bar\'s empty placeholder renders, while naming an id drives the same `useMetadataItem` lookup and the resolved action\'s button actually appears — the positive control that keeps the negative case from reading as "the wiring was never exercised". Pre-existing file, promoted to a pin here after being read end to end; it was written for objectui#4663 (the registered description promised a fallback that exists on no path) rather than for this direction, but its second case already drives the exact read this key needs pinned (objectui#8071).',
  },
  'record:quick_actions.requiredPermissions': {
    file: 'packages/plugin-detail/src/renderers/__tests__/record-quick-actions.requiredPermissions-gate.test.tsx',
    pins: 'The BLOCK-LEVEL ADR-0066 capability gate, read through `perms.hasCapabilities(required)` (objectui#10058) — distinct from an `ActionDef`\'s own per-action `requiredPermissions`, which `record-quick-actions.declared-action-ids-7182.test.tsx`\'s `gated` fixture already covers. Members are CAPABILITY names and the bar needs ALL of them, driven through the real renderer under a REAL stock `MePermissionsProvider`: an unheld capability and an unrecognised one each put the insufficient-permissions notice in place of the whole bar with no action drawn, a held one renders the bar, an EMPTY array and an ABSENT key are no gate at all, and the discriminating row is a PARTIAL grant on a two-entry array — gated only when the members are read as `.every` over the WHOLE array rather than its first element — with the all-granted case as that row\'s own positive control. Discriminators pin that a member is a capability and not an object action (`allowRead` on the object does not open the gate, a held capability opens it with `allowRead: false`, the enum member `manage` is gated rather than resolved to the read bit, and `read` / `update` are gated despite `allowRead` / `allowEdit`), a detector pins that the object-permission path is never asked about a member, and the gate holds with no `objectName` in the record context. A client that cannot resolve capabilities fails open: the role-based `PermissionProvider`, no provider at all, and a stock provider whose backend omits `systemPermissions`. The same file pins the registration\'s description as the installed spec\'s shared record-block describe, verbatim, and as the text the three sibling record blocks publish (objectui#10224). New file at objectui#8071 slice 4: no existing test drove `schema.requiredPermissions` itself, only the unrelated per-action field of the same name.',
  },
  'record:related_list.actions': {
    file: 'packages/plugin-detail/src/__tests__/RecordRelatedListRenderer.authoredActions-11163.test.tsx',
    pins: 'Members are action-id STRINGS resolved against the RELATED object\'s own `actions` — the `useMetadataItem` + `resolveDeclaredActionIds` lookup `record:quick_actions.actionNames` resolves through — and placed by each action\'s own `locations`, read through the real `SchemaRenderer`, this block\'s registration, the real `RelatedList` and the real data table. An authored list renders IN AUTHORED ORDER (`list_toolbar` members as header buttons, `list_item` members in each row\'s menu, one list feeding both) and REPLACES the host bridge\'s default rather than adding to it; an ABSENT key leaves the bridge\'s actions exactly as they were and makes no lookup at all (the control); `[]` draws none while the built-in New stays, because New is not an action id; and an authored action runs through the host\'s executor with its resolved definition. The refusals are member facts too: an id the registry cannot resolve and an id whose action declares neither list location are each named in a `role="status"` notice while the resolvable members still render, an array of inline action objects is refused whole, nothing is refused while the lookup is in flight, and with no host the list stays read-only while a bad id is still refused, so the refusal is the registry\'s and not the host\'s. New file (objectui#11163, the ENFORCE ruling on objectstack#20665), replacing the `NO_READ_SITE_TO_PIN` exemption this key carried since objectui#8071 slice 2.',
  },
  'record:related_list.add': {
    file: 'packages/plugin-detail/src/__tests__/recordRelatedListInputs.spec-parity.test.ts',
    pins: 'Every spec member key of `add` must be discoverable from its description, the published defaults must be the RENDERER\'s rather than the spec\'s prose, and `picker.filter` must be documented as a real restriction (objectui#3808).',
  },
  'record:related_list.columns': {
    file: 'packages/plugin-detail/src/__tests__/RecordRelatedListRenderer.columnMembers.test.tsx',
    pins: 'THE `page:header.actions` HOLE ON THIS KEY, asserted as the gap it is: the registration declares `of: \'string\'` and the block folds FIVE member spellings — a bare string, the spec-canonical `{ field }`, the legacy `{ name }` / `{ fieldName }`, and `{ key }`, a tail fallback that is this block\'s alone (`columnIdentity` REFUSES it, asserted next to it, which is the whole content of "tail"). Canonical-first is proven both ways on one mixed `{ field, name }` member, so a fold reading either key alone fails. Two rows carry the sharp edge: a member whose identity does not resolve is DROPPED — the fold fails closed (objectui#8793), because an entry it cannot name is an entry it cannot check, while `RelatedList` renders that entry anyway as `accessorKey || columnIdentity` (`accessorKey` is the instance, excluded from `columnIdentity` on purpose), so keeping it was a field-security bypass — ⚠️ two of the three legs of that bypass now have a SECOND gate downstream, `filterFLS` for a declared field that field security denies and, since objectui#9090, `filterRedacted` for a redacted one, both resolving the very `accessorKey || columnIdentity` pair this fold refuses, so what THIS fold alone still decides is a key the permission evaluator has no opinion about (one the child object never declares), measured by ablation on the merged base and pinned as THE RESIDUAL LEG in `RecordRelatedListRenderer.unresolvedIdentityFailClosed-8793.test.tsx`; the same row pins that the drop is by unresolvability rather than by matching the redacted name, and that an UNFILTERED list still hands the member down untouched — and a mixed set must come back SHORTER and in order, which is the non-vacuity a single-member array cannot give. Every positive carries its control in the same call (the member survives when a DIFFERENT field is redacted), and the instrument itself — `redactFields`, renderer-only until `@objectstack/spec` 17.5.0 declared it and objectui#8649 published it — is asserted to be published exactly when the contract declares it, so the file cannot be read as licensing it. The end-to-end half (an object member reaching the screen with VALUES) is objectui#5022\'s file, which drives `RelatedList` directly and never runs this fold (objectui#8071).',
  },
  'record:related_list.dataSource': {
    file: 'packages/plugin-detail/src/__tests__/RecordRelatedListRenderer.elementDataSource.test.tsx',
    pins: 'The per-element binding\'s own members, each read through the REAL renderer and asserted at what reaches `RelatedList`: `object` becomes the `objectName` this block lists, `view` resolves a saved view whose `columns` / `sort` / row cap land on the three keys `RECORD_RELATED_LIST_DATA_SOURCE` maps, an authored key WINS over the same key from the view, an unresolvable `view` reports instead of listing every child row, and the binding\'s own `filter` arrives ANDed with the view\'s rather than replacing it — so the mapping can never widen a named view. `baseFilter` is asserted to stay undefined in the same row, because routing the list scope onto the add-picker\'s restriction would filter the dialog and leave the list wide. Pre-existing file, promoted to a pin here after being READ rather than credited on its strings: it also names `columns` and `sort`, which it does NOT pin — those two are the objectui#8071 slice-1 trap, one slice on (objectui#8071).',
  },
  'record:related_list.filter': {
    file: 'packages/plugin-detail/src/__tests__/RelatedList.listFilter.test.tsx',
    pins: 'Members are spec `ViewFilterRule` entries, pinned at the WIRE rather than at a prop: `{ field, operator, value }` reaches `dataSource.find` as `[[field, operator, value]]` through the shared sink, ANDed BEHIND the parent relationship so "additional criteria" can only ever narrow this record\'s children. The negatives are what make it a member contract: an empty `filter: []` is unauthored (the query stays the byte-identical MongoDB-style object, not a freshly lowered AST that means the same), the composed AST a binding leaves on this key is accepted WITHOUT being converted twice, the filter survives onto the windowed fetch, and on the raw-URL fallback — a channel that cannot carry an operator — the block REFUSES to fetch rather than answering wider than the metadata asked. Pre-existing file, promoted after being read (objectui#8071).',
  },
  'record:related_list.parentDataSource': {
    file: 'packages/plugin-detail/src/renderers/__tests__/record-related-list.parentDataSource-12294.test.tsx',
    pins: 'The PARENT binding\'s own members, through the real `SchemaRenderer`, this block\'s registration and the real `RelatedList`, authored in the `properties` bag on an `app` page: `object` is the object the parent row is read from, the binding\'s `filter` reaches that read, `sort` decides WHICH row is the parent (the first by `sort`, read as one row, `$top: 1`, whatever `limit` says), and a `view` that does not resolve draws the configuration panel and reads nothing. The parent row is asserted at the CHILD query the list sends (`$filter` scoped to its id, or to its `relationshipValueField`) and at the rows it draws. No row, or a read the server refuses, draws the loud absence and sends no child query; a failed read draws the error panel. Without the key the record page\'s record is the parent and nothing is read for one (objectui#12294, ruling B on objectui#12296).',
  },
  'record:related_list.redactFields': {
    file: 'packages/plugin-detail/src/__tests__/RecordRelatedListRenderer.redactedDerivation-9053.test.tsx',
    pins: 'Members are field NAMES and the policy reaches EVERY path that decides columns, asserted on real DOM cells: redacting the only authored column does not resurrect it through auto-derivation, a partial redaction leaves the rest, a redacted field never enters the heuristic-walk or `highlightFields` derived set, and the same policy holds on `RelatedList` itself — each with its no-redaction control. The member-IDENTITY half (which spellings the block\'s fold can name, and that an unnameable one is dropped) is `record:related_list.columns`\' pin. Pre-existing file (objectui#9053), promoted to a member pin by objectui#8649, which published the key.',
  },
  'record:related_list.requiredPermissions': {
    file: 'packages/plugin-detail/src/renderers/__tests__/record-blocks.requiredPermissions-gate.test.tsx',
    pins: 'Members are ADR-0066 CAPABILITY names and the block needs ALL of them, driven through the real renderer under a REAL stock `MePermissionsProvider` (not a mocked `usePermissions`, which cannot discriminate the two reading paths): an unheld capability and an unrecognised one each put the insufficient-permissions notice in place of the block, a held one renders it, an EMPTY array and an ABSENT key are no gate at all, and the discriminating row is a PARTIAL grant on a two-entry array — gated only when the members are read as `.every` over the WHOLE array. Two discriminators pin that a member is a capability and not an object action (`allowRead` on the object does not open the gate; the enum member `manage` is gated rather than resolved to the read bit), and the role-based `PermissionProvider` pins the unreported-capabilities fail-open. One file runs every row against all three record blocks (objectui#10155); promoted to a member pin by objectui#8649, which published the key.',
  },
  'record:related_list.sort': {
    file: 'packages/plugin-detail/src/__tests__/RecordRelatedListRenderer.sortMembers.test.tsx',
    pins: 'Members are `{ field, order }` and reach `$orderby` verbatim and IN ORDER, driven through the block to the wire because `normalizeSortSpec` — not the block — is what reads them. The rows a declaration reading only "array" can never publish: a member with no `field` is dropped SILENTLY while its siblings survive (a two-key order quietly becomes one-key), an all-unusable array sends no `$orderby` rather than an empty clause, and the STRING arm the registration does not declare at all is read as the OData-ish `field` / `-field` — deliberately NOT `ListView.sort`\'s legacy space-separated clause, which the same spec union spells the same way and means differently (objectui#8221 retired that one at the derivation boundary only, and this key still accepts what it accepts). A CONTROL row pins the declaration as a bare array with no `of` and no description, so making it honest reds this file and forces the pins to be re-read (objectui#8071).',
  },
  'record:related_list.title': {
    file: 'packages/plugin-detail/src/renderers/__tests__/record-related-list.titleI18nLabel-10993.test.tsx',
    pins: 'The I18nLabel object arm on the list\'s heading: through the real `SchemaRenderer`, this block\'s registration and the real `RelatedList`, in the `{ type, properties }` form inside a record context. A `properties.title` map paints its `zh-CN` entry under `zh` and its `en` entry under `en`, every map listing `en` FIRST so an `en` or first-entry fallback fails the `zh` row; a plain-string control renders as authored, and a no-title control shows the related object\'s label instead, so the map rows read the authored text. `RecordRelatedListRenderer` resolves it with `pickLocalized` against the UI language. The manifest half (a map is not a `type-mismatch`) is `i18nLabelInputsManifest-10993.test.ts` in this directory (objectui#10993).',
  },
};

// `AWAITING_A_PIN` — the one shared reason every key in objectui#8068's
// measured population carried ("objectui#8071 owns writing the pin; delete this
// entry in the same change that registers it") — was DELETED by objectui#8071
// slice 18 together with its last three entries (`object-master-detail-form`'s
// `dataSource`, `details` and `fields`). With no entry carrying it, it was a
// reason for nothing, and a constant nothing reads is a claim nothing checks.
// The two docblocks below still contrast against it by name; read those
// mentions as the retired constant. The rule it stated survives as the
// discipline of this map: a key that needs a reason other than "no pin yet" —
// a shape a pin genuinely cannot express, a contract question upstream owns —
// gets its own string, which is why the map stays `Record<string, string>`.

/**
 * The reason the four keys objectui#8176 brought INTO this population carry.
 *
 * Separate from `AWAITING_A_PIN` on purpose, because the two say different
 * things about how the key got here and a reader must be able to tell them
 * apart. An `AWAITING_A_PIN` key was in objectui#8068's measured 77. These four
 * were not — not because anything about them changed, but because their blocks
 * were outside this file's `covered` set entirely while the console's
 * `registerLazy` stubs hid them from `getConfig`. The declarations are older
 * than the measurement that missed them.
 *
 * Same owner and same exit as their 58 neighbours: objectui#8071 writes the pin,
 * and the entry is deleted in the change that registers it.
 */
const AWAITING_A_PIN_NEWLY_JUDGED =
  'No per-block member pin today, and NOT one of objectui#8068\'s measured 77: this key was ' +
  'invisible to that measurement because its block sat outside `covered` behind a `registerLazy` ' +
  'stub until objectui#8176 loaded it. The declaration is older than the census that missed it, ' +
  'so this is a correction to the measured population and not a newly added array key. ' +
  'objectui#8071 owns writing the pin; delete this entry in the same change that registers it.';

// `NO_READ_SITE_TO_PIN` — the reason `record:related_list.actions` carried from
// objectui#8071 slice 2 ("No member pin is possible: nothing reads this key")
// — was DELETED by objectui#11163 together with its one entry. The maintainer
// ruled ENFORCE on objectstack-ai/objectstack#20665 (batch #247, 「业务上需要支持，
// ENFORCE」): `renderers/record-related-list.tsx` now reads `schema.actions`, so
// the key has the read site the constant said it lacked, and its member pin is
// registered in `MEMBER_PINS`. A reason no entry carries is a claim nothing
// checks, the same ground `AWAITING_A_PIN` went on. The docblocks further down
// still name it in their per-slice history; read those mentions as the retired
// constant.

/**
 * Array/object-armed inputs accepted WITHOUT a member pin for now, each with the
 * reason. Key format: `BLOCK.INPUT`.
 *
 * Fourth instance of this file's one exemption discipline, and the bar is the
 * one the three above already set: the divergence is explicit, reasoned,
 * issue-backed, and DELETED by a failing test once it stops describing anything.
 * `carries no stale member-pin exemption` fires the moment a key here acquires a
 * pin, and `every member-pin exemption names a key that is still
 * array/object-armed` fires when a key leaves the population.
 *
 * The ceiling below is the other half, and it is what makes this a transition
 * rather than an allowlist: a NEW array-typed key cannot be absorbed by adding
 * ONE MORE entry, because the count may only go down. ⛔ Neither that count nor
 * the ceiling is written into this docblock: both move at every slice, and a
 * figure here would be a claim nothing re-derives. The declaration below is the
 * count; `MEMBER_PIN_EXEMPTION_CEILING` is the bound.
 */
const MEMBER_PIN_EXEMPTIONS: Record<string, string> = {
  // element:button — objectui#8071 slice 7 pinned `action`, the block's one
  // remaining key; fully pinned, header kept as a landmark for a future grep.

  // element:number — objectui#8071 slice 7 pinned `filter`, the block's one
  // remaining key; fully pinned.

  // element:record_picker — objectui#8071 slice 3 pinned all four remaining
  // keys (`dataSource`, `label`, `placeholder`, `sort`); the block is now
  // fully pinned and this header stays only as a note for the next reader who
  // greps for it.

  // object-form — objectui#8071 slice 11 pinned the block's four remaining
  // keys (`customFields`, `dataSource`, `mobile`, `sections`); it is the FIRST
  // block this card closes, and this header stays only as a landmark for the
  // next reader who greps for it.

  // object-grid — objectui#8071 slice 12 pinned the four per-ROW keys
  // (`conditionalFormatting`, `operations`, `rowActions`, `rowColor`), slice 13
  // the four TOOLBAR keys (`batchActions`, `pagination`, `searchableFields`,
  // `selection`), slice 14 the three SOURCE-AND-DESTINATION keys
  // (`aggregations`, `dataSource`, `navigation`) and slice 17 the four QUERY
  // SHAPE keys (`columns`, `filter`, `grouping`, `sort`); the block is now
  // fully pinned in four bites, and this header stays only as a note for the
  // next reader who greps for it.

  // object-master-detail-form — objectui#8071 slice 15 pinned the two PARENT
  // SEED keys (`initialData`, `initialValues`, an alternate-spelling pair the
  // registration declares as one) and `sections`, and slice 18 the block's
  // other half (`dataSource`, `details`, `fields`); the block is now fully
  // pinned, and this header stays only as a note for the next reader who
  // greps for it.

  // object-metric — objectui#8071 slice 8 pinned the four QUERY members
  // (`dataSource`, `aggregate`, `filter`, `compareTo`) and slice 9 the two
  // PRESENTATION members (`trend`, `drillDown`); the block is now fully pinned
  // and this header stays only as a note for the next reader who greps for it.

  // page:accordion — objectui#8071 slice 7 pinned `items`, the block's one
  // remaining key; fully pinned.

  // page:tabs — objectui#8071 slice 7 pinned `items`, the block's one
  // remaining key; fully pinned.

  // record:activity — objectui#8071 slice 6 pinned `types`, the block's one
  // remaining key; fully pinned, header kept as a landmark for a future grep.

  // record:alert — objectui#8071 slice 6 pinned `action`, joining the `title`
  // and `body` pins this block already carried; fully pinned.

  // record:chatter / record:discussion — ONE renderer under two names, so
  // objectui#8071 slice 6 pinned both `feed` keys in one file; both fully
  // pinned.

  // record:path — objectui#8071 slice 6 pinned `stages`, the block's one
  // remaining key; fully pinned.

  // record:quick_actions — objectui#8071 slice 4 pinned both remaining keys
  // (`actionNames`, `requiredPermissions`); the block is now fully pinned and
  // this header stays only as a note for the next reader who greps for it.

  // record:related_list — objectui#8071 slice 2 pinned `columns`, `dataSource`,
  // `filter` and `sort`; objectui#11163 pinned `actions`, the key that was left
  // for a reason of its own (no read site) until the ENFORCE ruling on
  // objectstack-ai/objectstack#20665 gave it one. The block is now fully
  // pinned, and this header stays only as a note for the next reader who
  // greps for it.

  // object-calendar — objectui#8176 brought both `calendar` and `dataSource`
  // into this population (see `NEWLY_JUDGED_UNPINNED_MEMBERS`'s docblock);
  // objectui#8071 slice 5 pinned both, so the block is now fully pinned and
  // this header stays only as a note for the next reader who greps for it.

  // object-kanban — objectui#8176 brought both `columns` and `dataSource` into
  // this population (see `NEWLY_JUDGED_UNPINNED_MEMBERS`'s docblock);
  // objectui#8071 slice 16 pinned both, so the block is now fully pinned, the
  // objectui#8176 correction is spent to the last key, and this header stays
  // only as a note for the next reader who greps for it.

  // ⚠️ 17.5.0 BOOKINGS — objectui#11111 decision 3 = B (record 5902351047).
  // The array/object-armed inputs of the blocks 17.5.0 newly judges, owed a
  // member pin by objectui#11168, stood here. All six are pinned now, so no
  // booking is left: `action:group.actions` and `action:menu.actions` by
  // slice 1, and `element:definition-list.items` and `element:repeater`'s
  // `fields`, `filter` and `sort` by slice 2, each registered in
  // `MEMBER_PINS`. Header kept as a landmark for a future grep.

  // ⚠️ 17.6.0 BOOKINGS — objectui#11438 ruling A′ (record 5965062249). The
  // two array/object-armed inputs of `record:line_items` owed a member pin by
  // objectui#11536, `columns` and `dataSource`, stood here. That card pinned
  // both, and the two array keys it declared (`filter`, `sort`) with them,
  // each registered in `MEMBER_PINS`, so no booking is left. Header kept as a
  // landmark for a future grep.

  // ⚠️ OBJECTSTACK `main` PIN BOOKINGS — the seat decision D1 = A on
  // objectui#12971 (record 6267645900), which applies objectui#11111 decision
  // 3 = B to the pin bump. The six array/object-armed inputs of `list-view`
  // owed a member pin by objectui#13047 (`data`, `columns`, `filter`, `sort`,
  // `options`, `dataSource`) stood here. That card pinned all six, and every
  // structured key it published with them, each registered in `MEMBER_PINS`,
  // so no booking is left. Header kept as a landmark for a future grep.
};

/**
 * The ids the ceiling below moved for, named so the move is auditable, MINUS
 * whichever of them objectui#8071 has since converted to a real pin.
 *
 * A ceiling that goes up is worth exactly as much as the account of why, and
 * "+4, trust me" is not an account. Pinning the four by name means the
 * correction admitted four SPECIFIC pre-existing keys and nothing else: a
 * fifth entry cannot hide inside the same headroom, because `the member-pin
 * exemption list only ratchets DOWN` still reads the total.
 *
 * This list is CHECKED against the live `MEMBER_PIN_EXEMPTIONS` state (`the
 * ceiling correction admits exactly the four keys objectui#8176 made
 * visible`), so it shrinks as the four are pinned rather than staying a
 * frozen record of four forever — the frozen record of WHY the ceiling went
 * up is `MEMBER_PIN_EXEMPTION_CEILING`'s own docblock below, not this array.
 * objectui#8071 slice 5 pinned `object-calendar.calendar` and
 * `object-calendar.dataSource`, and slice 16 pinned `object-kanban.columns` and
 * `object-kanban.dataSource` — so the correction is now SPENT and this array is
 * empty.
 *
 * ⛔ An empty array is not a dead assertion, and deleting it would be the wrong
 * reading of the emptiness. The check below has two directions and only the
 * first one empties out: the second — every exemption on a block objectui#8176
 * newly judged must be one of the named four — now reads "no lazily registered
 * block may carry a member-pin exemption AT ALL". That is the strongest state
 * this list has ever asserted, and it is the state that refuses a future
 * exemption from sliding in under the same correction.
 */
const NEWLY_JUDGED_UNPINNED_MEMBERS: string[] = [];

/**
 * How many keys may be exempt. Ratchet: this number may only ever go DOWN.
 *
 * Measured with objectui#8068 and pinned so the list cannot grow. Without it the
 * cheapest way to green a newly added array-typed input is an exemption entry
 * with the same reason as its 58 neighbours — which is exactly the "voluntary"
 * state this direction was built to end, one entry further in.
 *
 * ## 58 -> 62, and why that is a CORRECTION rather than a loosening
 *
 * ⚠️ The one number in this file that has gone UP. It is the judgement call in
 * objectui#8176's change and it is written out here rather than left in a diff,
 * because a reviewer who disagrees with the reading should be able to find it
 * without reading the whole card.
 *
 * The 58 was measured "over this file's own `covered` set" — and objectui#8176
 * is the finding that `covered` was wrong: it held 27 of the 42 spec-carried
 * blocks, because `getConfig` is loaded-only and the console registers plugin
 * blocks with `registerLazy`. `object-calendar` and `object-kanban` were never
 * offered to objectui#8068's census. Over the corrected population the same
 * measurement, by the same method, yields 81 array/object-armed inputs across 24
 * blocks, 19 pinned and 62 not.
 *
 * So this raise admits no new key. It admits four PRE-EXISTING declarations that
 * the census could not see, named individually in
 * `NEWLY_JUDGED_UNPINNED_MEMBERS` above and asserted by name below. Nothing
 * about what the ratchet forbids changes: a genuinely new array-typed input
 * still cannot be absorbed, because 62 is now the true measured floor and the
 * count may still only go down from it.
 *
 * ⛔ The reading a future edit must not take from this: that a ceiling may be
 * raised to fit a list. The ONLY thing that licensed it here is that the
 * population itself was mis-measured, and that fact is independently asserted —
 * if `states the size of the population it judges` and
 * `no spec-carried block is registered but unloaded` ever stop holding, this
 * paragraph stops being true and the number owes a re-derivation, not a bump.
 *
 * ## 62 -> 58, and why the number MOVES WITH the list rather than trailing it
 *
 * objectui#8071's first slice converted four keys to pins — `object-form.fields`
 * and `object-grid`'s `exportOptions` / `bulkActions` / `bulkActionDefs` — and
 * deleted their four entries. A ceiling left at 62 would then have held FOUR
 * unused slots, and unused slots are exactly the thing this constant exists to
 * deny: the next genuinely new array-typed key could have been greened with an
 * exemption entry and no pin, which is the "voluntary" state the ratchet was
 * built to end. So the ceiling follows the list down in the same change that
 * shortens it. That is what "may only ever go DOWN" has to mean to be worth
 * anything — a number nobody lowers is a budget, not a ratchet.
 *
 * ## 58 -> 54, the second slice, and the rule applied rather than restated
 *
 * objectui#8071's second slice converted four keys on ONE block —
 * `record:related_list`'s `columns`, `dataSource`, `filter` and `sort` — and
 * deleted their four entries, so the ceiling follows to 54 in the same commit.
 * Nothing about the argument above changes; this is the paragraph existing to
 * show it is a rule and not a one-off.
 *
 * ⚠️ The block is NOT emptied: `record:related_list.actions` stays exempt, and
 * on a reason of its own (`NO_READ_SITE_TO_PIN`) rather than the shared one. A
 * ceiling of 54 counts it like any other entry — a key that cannot be pinned
 * still occupies a slot, because the ratchet counts EXEMPTIONS, not excuses.
 *
 * ## 54 -> 50, the third slice, and the first WHOLE BLOCK closed
 *
 * objectui#8071's third slice converted all four remaining keys of ONE block —
 * `element:record_picker`'s `dataSource`, `label`, `placeholder` and `sort` —
 * and deleted their four entries, so the ceiling follows to 50 in the same
 * commit. Unlike `record:related_list` (slice 2), this block has no
 * `NO_READ_SITE_TO_PIN` leftover: every key it declares now carries a real
 * member pin, and the `element:record_picker` header comment above stays only
 * as a landmark for a future grep, not because anything under it is exempt.
 *
 * Two of the four were PROMOTED pre-existing files, read end to end before
 * being credited rather than trusted on their strings — the same discipline
 * slices 1 and 2 applied: `record-picker-element-data-source.test.tsx` (for
 * `dataSource`) and `record-picker-label-placeholder-i18n.test.tsx` (for BOTH
 * `label` and `placeholder`, which is why those two rows in `MEMBER_PINS` point
 * at the same file — it was written to cover the pair). `sort` had no
 * candidate at all — nothing in the repo exercised the flat, standalone
 * `properties.sort` key before this slice — so it is the one genuinely new
 * file.
 *
 * ## 50 -> 48, the fourth slice, and a two-key block closed the same way
 *
 * objectui#8071's fourth slice converted both remaining keys of ONE block —
 * `record:quick_actions`'s `actionNames` and `requiredPermissions` — and
 * deleted their two entries, so the ceiling follows to 48 in the same commit.
 * Like `element:record_picker` (slice 3) and unlike `record:related_list`
 * (slice 2), this block has no `NO_READ_SITE_TO_PIN` leftover: both declared
 * keys have a real read site in `renderers/record-quick-actions.tsx` — the
 * `actionNames` -> `useMetadataItem` lookup, and the `requiredPermissions`
 * block-level gate that runs before any action is drawn — so the block drops
 * out of `MEMBER_PIN_EXEMPTIONS` entirely.
 *
 * One of the two pins PROMOTES a pre-existing file
 * (`recordQuickActionsInputs.actionNamesFallback.test.tsx`, written for
 * objectui#4663 but already driving the exact `actionNames` read this key
 * needs, read end to end before being credited); `requiredPermissions` had no
 * candidate — every existing reference to that name in this renderer's test
 * suite is an ActionDef's own PER-ACTION field, a different mechanism — so it
 * is a new file.
 *
 * ## 48 -> 46, the fifth slice, and a whole `object-calendar` block closed
 *
 * objectui#8071's fifth slice converted the two keys objectui#8176 had left
 * unpinned on `object-calendar` — `calendar` and `dataSource` — and deleted
 * their two entries, so the ceiling follows to 46 in the same commit. Every
 * OTHER key this block declares (`data`, `filter`, `sort`, `staticData`) was
 * already pinned, so the block now carries zero exemptions, the same shape
 * `element:record_picker` (slice 3) and `record:quick_actions` (slice 4)
 * closed in — chosen for exactly that reason: a two-key remainder on one
 * already-mostly-pinned block, closeable outright rather than left with a
 * straggler.
 *
 * `dataSource` is the per-element binding every `elementDataSourceBlock`
 * publishes (`ELEMENT_DATA_SOURCE_INPUT`, `@object-ui/core`) — the same
 * mechanism `element:record_picker.dataSource` and
 * `record:related_list.dataSource` already pin — and it PROMOTES a
 * pre-existing file, `ObjectCalendar.elementDataSource.test.tsx`, read end to
 * end before being credited: it already drove the binding's `object` write
 * onto `objectName`, `filter`/`sort` read off the named view, an unresolvable
 * `view` reporting instead of fetching unfiltered, and a calendar with no
 * binding behaving exactly as before. `calendar` had no single candidate that
 * covered its own member set (which keys of the config object become which
 * part of an event, and which of the two spellings — the nested object or the
 * flat legacy fields `getCalendarConfig` falls back to — wins when a schema
 * somehow carries both) — the ladder and all-day pieces of that config were
 * each already pinned narrowly (`ObjectCalendar.colorFieldLadder-7243.test.tsx`,
 * `ObjectCalendar.allDayFieldIsHonoured-8026.test.tsx`) but neither, nor
 * anything else, asserted `startDateField`/`endDateField` reaching an event's
 * `start`/`end`, `titleField` outranking the object's own display-name
 * resolution, or the object-vs-flat precedence — so it is a new file,
 * `objectCalendarConfigMembers-8071.test.tsx`.
 *
 * ## 46 -> 41, the sixth slice, and FIVE whole blocks closed at once
 *
 * objectui#8071's sixth slice took the five `record:*` detail-panel blocks that
 * each carried exactly ONE unpinned key — `record:activity.types`,
 * `record:alert.action`, `record:chatter.feed`, `record:discussion.feed` and
 * `record:path.stages` — and pinned all five, so the ceiling follows to 41 in
 * the same commit. Every one of the five blocks now carries zero exemptions,
 * the shape `element:record_picker` (slice 3), `record:quick_actions` (slice 4)
 * and `object-calendar` (slice 5) each closed in; this slice is the first to
 * close more than one block, and the batch is coherent rather than opportunistic
 * — one package (`packages/plugin-detail`), one family, and the selection rule
 * is stateable in a sentence (every block whose remainder was exactly one key).
 *
 * `record:chatter.feed` and `record:discussion.feed` are ONE key on ONE
 * renderer: the console registers `RecordChatterRenderer` under both names
 * against the same `CHATTER_INPUTS`, so both rows point at one file that runs
 * every case against both names — the shape slice 3 used for
 * `record-picker-label-placeholder-i18n.test.tsx`, which covered `label` and
 * `placeholder` together.
 *
 * One of the five PROMOTES a pre-existing file: `recordActivityFeed.test.ts`
 * for `record:activity.types`, read end to end before being credited rather
 * than trusted on its greps — it already asserts the allow-list's member
 * semantics directly on `applyFeedConfig` (the call the renderer makes on every
 * render), including objectui#5841's three distinct ways an authored list can
 * name nothing and why none of them is "no filter". The other three files are
 * new: the six existing `record:path` suites all use `stages[]` as a FIXTURE
 * for a different subject (accessible names, the container label, the readout's
 * inertness, cross-row agreement) and none would fail if `value`, `label` and
 * `terminal` swapped roles; the six `record:alert` suites reference `action`
 * only inside a props bag whose subject is `resultDialog` or the `visible`
 * predicate; and the one `record:chatter` suite is about the host's `loading`
 * signal and never authors `feed` at all.
 *
 * ⚠️ RE-POINTED by objectui#8934, which reversed the reading this paragraph
 * used to carry. It recorded the `feed` pin as a LIMIT: `config.feed` reached
 * `RecordActivityTimeline`, which read the five AFFORDANCE members only, while
 * `record:activity`'s FILTER members (`types`, `limit`, `showCompleted`,
 * `unifiedTimeline`) were applied by `applyFeedConfig`, which only
 * `record-activity.tsx` called — so they were inert nested inside `feed`, and
 * that was called a contract defect. It was an IMPLEMENTATION GAP against a
 * WIDER protocol instead: `@objectstack/spec` declares
 * `RecordChatterProps.feed` as `RecordActivityProps` (the `feed` member of
 * `RecordChatterProps` in the spec's `ui/component.zod.ts`),
 * so objectui#8934 closed the gap in `renderers/record-chatter.tsx` rather than
 * narrowing the declaration, and the four filter members are live on that path
 * now. (`filterMode` and `enableMentions` were the remainder; objectui#8968
 * closed them too, so every member of the declared shape is read there now.)
 * This block's own row is unaffected either way: nothing in this file asserts
 * on that description string.
 *
 * ## 41 -> 37, the seventh slice, and the LAST four one-key blocks closed
 *
 * objectui#8071's seventh slice applied slice 6's selection rule to what it left
 * behind: every block whose remainder was exactly one key. Four qualified —
 * `element:button.action`, `element:number.filter`, `page:accordion.items` and
 * `page:tabs.items` — so the ceiling follows to 37 in the same commit, and all
 * four blocks now carry zero exemptions.
 *
 * The batch is coherent rather than opportunistic on the same terms slice 6 set:
 * one package (`packages/components`) registers all four, the two `element:*`
 * keys sharing `renderers/basic/elements.tsx` and the two `page:*` keys sharing
 * `renderers/layout/containers.tsx`, and the rule is stateable in a sentence.
 *
 * ⚠️ TWO one-key blocks were deliberately NOT taken, and neither is a leftover
 * this slice could have absorbed:
 *
 *   - `record:related_list.actions` is the `NO_READ_SITE_TO_PIN` sentinel, and
 *     the reading was RE-MEASURED here rather than inherited: on this tree
 *     `renderers/record-related-list.tsx` still contains ZERO case-sensitive
 *     occurrences of `actions` (control: `import` reads 9 in the same file), and
 *     the only near-matches are `useRelatedRecordActions` / `relatedActions` —
 *     the host bridge the constant already names. Nothing to pin, still.
 *   - `object-kanban`'s `columns` / `dataSource` are the
 *     `NEWLY_JUDGED_UNPINNED_MEMBERS` pair, held by an unruled contract question
 *     (objectui#8913) about whether `columns` survives as judged structure at
 *     all. Pinning a shape a pending ruling may delete would be worse than
 *     leaving it exempt, so `NEWLY_JUDGED_UNPINNED_MEMBERS` is UNCHANGED by this
 *     slice — no block it names was touched.
 *
 * ⇒ After this slice every remaining exemption sits on one of four
 * MULTI-key blocks (`object-grid` 15, `object-form` 7,
 * `object-master-detail-form` 6, `object-metric` 6) plus the two held keys. The
 * "close a block outright by taking its last key" shape is now EXHAUSTED, and
 * the next slice is the first that has to take a partial block or close a
 * multi-key one whole — stated here so the next reader does not spend the
 * search rediscovering it.
 *
 * Three of the four pins are new files; none of the four keys had a
 * pre-existing file covering its member SET, and each candidate was read end to
 * end before being rejected rather than dismissed on its greps.
 * `element-button-action.test.tsx` drives only `type` and `to` on one
 * navigation action; `action-bodyExtra-forward.test.tsx` pins one member across
 * four renderers; `page-accordion-icon.test.tsx` pins `icon` alone; the five
 * `page:tabs` suites pin one member each; and
 * `element-number.contractEnvelope-6726.test.tsx` drives the same `find()`
 * fallback branch but never authors a `filter`, so the locator itself would
 * refuse it. ⚠️ `action-bodyShape-forward.test.tsx` is the one that had to be
 * refused rather than merely passed over: it NAMES `element:button` and the key
 * `action`, so it would satisfy the locator, while what it actually says is
 * that `element:button` is deliberately out of its scope. Crediting it would
 * have been a pin that asserts the opposite of its claim — the false-negative
 * shape objectui#8068 exists to end. Its boundary is instead pinned as
 * behaviour in the new file, which authors `bodyShape` and asserts it is
 * dropped.
 *
 * ## 37 -> 33, the eighth slice, and the FIRST partial bite of a multi-key block
 *
 * objectui#8071's eighth slice is the first that could not close a block by
 * taking its last key — slice 7 exhausted that shape — so it takes a PART of
 * one, and the part is chosen by a rule rather than by convenience:
 *
 *   **every `object-metric` member that shapes the aggregate query behind the
 *   NUMBER the tile paints.**
 *
 * Four qualify — `dataSource`, `aggregate`, `filter` and `compareTo` — so the
 * ceiling follows to 33 in the same commit. The rule is mechanical, not
 * editorial: those four are exactly the members that reach
 * `ObjectMetricWidget`'s `fetchMetric` / `computeOne` (`dataSource` gates the
 * effect; `aggregateKey`, `resolvedFilterKey` and `compareToKey` are its other
 * dependencies), and the two left — `trend` and `drillDown` — reach neither.
 * They shape what is drawn AROUND the number once it exists: a STATIC badge
 * beside it, and a drawer opened by clicking it. Neither can change the number.
 *
 * ⇒ That is what the next slice inherits, and it is cheap to state: the two
 * PRESENTATION members of `object-metric`, `trend` and `drillDown`. They were
 * left together on purpose rather than one being swept in — `drillDown` does
 * issue a query of its own (the drawer's record list, off the same resolved
 * filter), so "reaches an adapter" would have been the wrong cut and is stated
 * here so the next reader does not have to re-derive why it was not used.
 *
 * TWO of the four pins PROMOTE pre-existing files, each read end to end before
 * being credited and each given the one row it was missing:
 *
 *   - `ObjectMetric.elementDataSource.test.tsx` (objectstack#6953) already drove
 *     the binding's `object` and `view` members through the real renderer, with
 *     an unresolvable `view` reporting rather than aggregating the whole object
 *     and a binding-less metric unchanged. What it did not have was the
 *     NEGATIVE direction, so this slice adds it: the view fixture's `columns`,
 *     `sort` and `pagination` are asserted absent from the aggregate call.
 *     Without that the pin would have been satisfied by a mapping that forwarded
 *     everything, which here would mean a metric silently ordered and paged by a
 *     list view's presentation settings.
 *   - `ObjectMetricWidget.compareTo.test.tsx` (objectui#3337) already asserted
 *     the `{ kind, dimension? }` member set — `kind` choosing both window and
 *     label on a quarter-scoped fixture where the two values disagree about
 *     each, `dimension` carried but inert, and the no-`compareTo` single-pass
 *     control. It drove `ObjectMetricWidget` directly, so this slice adds the
 *     row that mounts `type: 'object-metric'` through `SchemaRenderer`: the
 *     block's `ElementDataSourceGate` shell re-binds only `objectName` and
 *     `filter` and forwards the rest untouched, and that is now asserted rather
 *     than assumed. ⚠️ It is also why the file names the block at all — the
 *     locator requires it, and a docblock mention alone would have been the
 *     locator satisfied by prose rather than by behaviour.
 *
 * `aggregate` and `filter` share ONE new file,
 * `objectMetricQueryMembers-8071.test.tsx` — the shape slice 3 used for
 * `record-picker-label-placeholder-i18n.test.tsx` and slice 6 for the
 * chatter/discussion pair — because the two keys meet inside a single adapter
 * call and the assertions have to be written against each other to stay
 * independent: the `aggregate` rows author NO filter (so the bag comparison is
 * blind to the filter spelling), and the `filter` rows are the ones that pin it.
 *
 * Every other candidate was read end to end and rejected with a reason, not
 * dismissed on its greps: `public-block-binding-reach.test.tsx` states its own
 * narrowness — one question per block, "did any call carry the object name" —
 * and lists `aggregate` only as a plausible sample value;
 * `widget-dom-leak-sweep.test.tsx` is the DOM-attribute canary, where
 * `aggregate` is a stub returning `[]`; `ObjectMetricWidget.i18nLabel.test.tsx`
 * authors `aggregate`, `trend` and `drillDown` purely to make the drill-down
 * reachable, and its subject is `I18nLabel` resolution — crediting it for
 * `trend` or `drillDown` would have been slice 7's
 * `action-bodyShape-forward.test.tsx` mistake in a new place. The remaining
 * seven files that name `object-metric` do so in prose, in a membership list,
 * or in a designer-inspector fixture.
 *
 * ⚠️ Unchanged by this slice: `NEWLY_JUDGED_UNPINNED_MEMBERS` (no block it names
 * was touched) and `record:related_list.actions`, whose `NO_READ_SITE_TO_PIN`
 * reading was not re-measured here because this slice took a different block —
 * slice 7's measurement stands as the last one taken.
 *
 * ## 33 -> 31, the ninth slice, and the first multi-key block closed by halves
 *
 * objectui#8071's ninth slice takes what slice 8 left and named: the two
 * PRESENTATION members of `object-metric`, `trend` and `drillDown`, so the
 * ceiling follows to 31 in the same commit and the block drops out of
 * `MEMBER_PIN_EXEMPTIONS` entirely — the first block closed in TWO bites rather
 * than one, which is the shape every remaining block (`object-grid` 15,
 * `object-form` 7, `object-master-detail-form` 6) now has to be closed in.
 *
 * The cut is slice 8's, restated because it is the part that is easy to get
 * wrong: `drillDown` DOES issue a query of its own — the drawer's record list
 * runs off the same resolved filter — so "reaches an adapter" is not the line.
 * The line is `fetchMetric` / `computeOne`, the path that produces the NUMBER.
 * Neither of these two can change it; they shape what is drawn around it.
 *
 * BOTH pins are new files, and the measurement that decided it is worth
 * recording because it corrects the prior note rather than repeating it.
 * `ObjectMetricWidget.i18nLabel.test.tsx` was flagged for this slice as prior
 * art that "satisfies any mechanical locator for either" key. Re-measured here,
 * that is true only of a locator keyed on the KEY NAME: the file contains ZERO
 * occurrences of the string `object-metric` (control: `ObjectMetricWidget`
 * reads 15 in the same file), and `memberPinProblem` requires the BLOCK name
 * too, so this repo's own locator would have refused it. The substance of the
 * warning stands — it authors `trend` and `drillDown` purely to make the drill
 * reachable, and its subject is `I18nLabel` resolution — so it is left intact
 * rather than promoted. The only other file naming block AND key is
 * `ObjectMetricWidget.compareTo.test.tsx`, already the `compareTo` pin, which
 * never authors a `trend` prop at all: crediting it would have been slice 7's
 * `action-bodyShape-forward.test.tsx` mistake in a third place.
 *
 * ⚠️ `drillDown` is pinned on the members that ACT and deliberately not on the
 * ones that do not. When this slice landed, `ObjectMetricWidget` hand-rolled its
 * own drawer instead of using the shared `DrillDownDrawer`, so five members the
 * shared component honours had no read site here (`columns`, `maxRows`,
 * `target: 'navigate'`, `filter`, `mode`). That was filed (objectui#8970) rather
 * than frozen into the pin — the same choice slice 6 made for
 * `record:activity`'s filter members (objectui#8934), and for the same reason:
 * an assertion that a member is dead has to be deleted before anyone can make it
 * live.
 *
 * ⇒ That reason has since paid out. objectui#8970 routed the block through
 * `DrillDownDrawer`, and three of the five (`columns`, `maxRows`,
 * `target: 'navigate'`) now act; nothing had to be deleted to let them. They are
 * pinned on their effects in
 * `ObjectMetricWidget.drillRoutedToSharedDrawer-8970.test.tsx`. `filter` and
 * `mode` still have no read site — the shared drawer honours neither — and are
 * still not asserted, for the reason above.
 *
 * ⚠️ Unchanged by this slice: `NEWLY_JUDGED_UNPINNED_MEMBERS` (no block it names
 * was touched) and `record:related_list.actions`, whose `NO_READ_SITE_TO_PIN`
 * reading was not re-measured here either — slice 7's measurement still stands
 * as the last one taken.
 *
 * ## 31 -> 28, and the first bite out of `object-form`
 *
 * objectui#8071's tenth slice takes three `object-form` keys — `initialValues`,
 * `initialData` and `submitBehavior` — so the ceiling follows to 28 in the same
 * commit. The block is NOT closed: `customFields`, `dataSource`, `mobile` and
 * `sections` remain, which is the two-bite shape slice 9 said every remaining
 * block now has.
 *
 * ⚠️ The dispatch that opened this slice named the three keys objectui#8068's
 * card body flags as "near misses" (`object-form.fields`,
 * `object-grid.exportOptions`, `object-grid.bulkActions`/`bulkActionDefs`).
 * ALL FOUR have been pinned since slice 1 (PR objectui#8737). The card body's
 * enumerated list has been stale since then and the comment at
 * issuecomment-5599611864 already says so: the authoritative list is THIS
 * constant's table, never the card's prose. Recorded here because the stale
 * list has now mis-aimed a dispatch a second time.
 *
 * The two pins are new-file and grown-file respectively, and the distinction is
 * worth the line because slice 1's finding was about exactly this. The
 * `initialValues`/`initialData` pair had NO file constraining the choice between
 * them, so it is a new one. `submitBehavior` already had
 * `ObjectForm.submitBehavior.test.tsx`, whose whole subject is the key and which
 * drives the real renderer — a genuine near miss, unlike slice 1's two — but it
 * left two members of the read unasserted (`delayMs`, and the `next-record`
 * arm), so it was GROWN before it was registered rather than credited as found.
 *
 * ⚠️ Unchanged by this slice: `NEWLY_JUDGED_UNPINNED_MEMBERS` (no block it names
 * was touched) and `record:related_list.actions`, whose `NO_READ_SITE_TO_PIN`
 * reading was not re-measured here either — slice 7's measurement still stands.
 *
 * ## 28 -> 24, and the FIRST BLOCK objectui#8071 closes
 *
 * The eleventh slice takes `object-form`'s four remaining keys —
 * `customFields`, `dataSource`, `mobile` and `sections` — so the ceiling follows
 * to 24 in the same commit and the block leaves `MEMBER_PIN_EXEMPTIONS`
 * entirely. It is the first block this card closes; `object-metric` (slice 9)
 * closed as a block too, but over two slices of a population this card had
 * already halved, and `object-form` is the first taken to zero from the list as
 * the card body enumerated it.
 *
 * ⚠️ The batch was selected from THIS CONSTANT, re-taken by the implementing
 * seat before its first edit with a depth-aware scan of the direct property
 * keys — not from the card's prose list, which is stale in both directions and
 * has now mis-aimed two dispatches. The card body carries a dated block saying
 * so; this is the third slice in a row to record it.
 *
 * Three of the four are NEW FILES, and one is a promotion, which is the same
 * distinction slices 1 and 10 turned on. `sections`, `customFields` and `mobile`
 * had no file constraining their members at all. `dataSource` had
 * `ObjectForm.elementDataSource.test.tsx`, whose whole subject IS the key and
 * which drives the real block — a genuine near miss — but it stated only WHICH
 * members are mapped and never their precedence against the block's own flat
 * keys, so it was GROWN by that row before being registered rather than
 * credited on its strings.
 *
 * ⚠️ Two of the four pin a member fact that CONTRADICTS the surface that
 * declares it, and both are handed back as findings rather than repaired here,
 * because repairing either is a renderer change and this card writes pins only:
 * `customFields` is documented as "merged over the set generated from object
 * metadata" and REPLACES it (the per-member merge exists as code and is
 * unreachable), and the default layout DROPS a section's `description` while
 * the five rebuild arms copy it.
 *
 * ⚠️ Unchanged by this slice: `NEWLY_JUDGED_UNPINNED_MEMBERS` (no block it names
 * was touched) and `record:related_list.actions`, whose `NO_READ_SITE_TO_PIN`
 * reading was not re-measured here either — slice 7's measurement still stands.
 *
 * ## 24 -> 20, and the first bite out of `object-grid`
 *
 * The twelfth slice takes four `object-grid` keys — `conditionalFormatting`,
 * `operations`, `rowActions` and `rowColor` — so the ceiling follows to 20 in
 * the same commit. The block is NOT closed: it held 15, the largest remaining,
 * and is the first that cannot fit one slice at all.
 *
 * ⚠️ The batch was re-taken from THIS CONSTANT by the implementing seat before
 * its first edit, on `origin/main` `0ee6e316e`, and it is NOT the batch the
 * dispatch suggested. The dispatch guessed at the grid's query-and-display core
 * (`columns`, `sort`, `filter`, `grouping`) and said in as many words that it
 * had not read the sites. Read, they are four separate slices: `columns` pulls
 * in the whole column fold and the `$select` projection, `grouping` pulls in
 * `useGroupedData`, and `filter`/`sort` already carry dedicated files
 * (`gridFilterInputSpelling`, `gridArrayArmOrderby-8973`,
 * `gridRetiredStringSort-8767`, `serverSorting`) each of which needs reading end
 * to end before it can be promoted or grown. What IS one read is the per-ROW
 * layer: `rowColor` and `conditionalFormatting` are consumed on ADJACENT lines
 * of the `DataTable` props (`rowClassName` / `rowStyle`) and land on the same
 * `<tr>`; `operations` and `rowActions` are read inside the same fifteen-line
 * row-affordance fold and meet at the same gate in `resolveRowCrudAffordances`,
 * where — the finding this slice pins — they are a UNION rather than an
 * intersection. Two files, four keys, two reads.
 *
 * Two of the four are a NEW FILE covering a PAIR, one is a new file of its own,
 * and one is a promotion after growth — the distinction slices 1, 10 and 11
 * turned on. `rowColor` and `conditionalFormatting` had no file constraining
 * their members AT the grid: `useRowColor.prototypeGuard.test.tsx` calls the
 * hook directly and never names the block (measured: ZERO occurrences of
 * `object-grid` AND zero of the word `rowColor`, control `useRowColor` reads 7
 * in the same file), so this repo's
 * own locator would have refused it, and it is green against a grid that never
 * hands the resolver to the table. `operations` had `exportGate.test.tsx` for
 * the `export` member alone, and two suites for the layers ANDed on top of the
 * key rather than for the key; the three members' own contract was unstated.
 * `rowActions` had `legacyRowActionDispatch.test.tsx`, whose whole subject IS
 * the key and which drives the real renderer — a genuine near miss — but it
 * never authored the two CANONICAL members (`edit`, `delete`), which is the
 * half the read site actually branches on, so it was GROWN by those rows before
 * being registered rather than credited as found.
 *
 * ⚠️ Unchanged by this slice: `NEWLY_JUDGED_UNPINNED_MEMBERS` (no block it names
 * was touched) and `record:related_list.actions`, whose `NO_READ_SITE_TO_PIN`
 * reading was not re-measured here either — slice 7's measurement still stands.
 *
 * ## 20 -> 16, the second bite out of `object-grid`, and its TOOLBAR layer
 *
 * The thirteenth slice takes four more `object-grid` keys — `batchActions`,
 * `pagination`, `searchableFields` and `selection` — so the ceiling follows in
 * the same commit. The block is still not closed; slice 12 said it is the first
 * that cannot fit one slice at all, and this is the second of the bites that
 * statement predicted.
 *
 * ⚠️ The batch was re-taken from THIS CONSTANT by the implementing seat before
 * its first edit, on `origin/main` `26ac50369`, and the dispatch declined to
 * name one at all — it handed over slice 12's reading and asked for a batch
 * chosen by where the READS cluster. They cluster on the fold that assembles
 * `dataTableSchema`: `pagination`, `searchableFields` and `selection` are each
 * the canonical half of a canonical-vs-deprecated pair resolved there
 * (`showPagination` / flat `pageSize`, `showSearch`, `selectable`) and land on
 * adjacent props of the same `data-table` node, and `batchActions` is the
 * fourth such pair — `batchActions ?? bulkActions` — whose result feeds the
 * very gate `selection`'s last fallback arm reads. Four keys, one read of one
 * fold, three files.
 *
 * ⭐ The two keys that look alike read their own presence in OPPOSITE ways, and
 * that is the finding this slice's shape exists to surface. `pagination` is read
 * as `!== undefined`, so the object's presence alone enables paging and
 * overrules `showPagination: false`; `selection` is read as `?.type`, so the
 * object's presence alone does nothing. Two adjacent object-armed keys on one
 * block, opposite rules, neither description saying so.
 *
 * One of the three files is NEW and two are PROMOTIONS AFTER GROWTH — the
 * distinction slices 1, 10, 11 and 12 turned on. `pagination` and `selection`
 * had no file constraining their members at the grid at all
 * (`groupedPagination.test.tsx` names the block and the key and would satisfy a
 * string locator, but its subject is GROUP paging and its one `pagination`
 * fixture exists to suppress a pager; `data-table-selection-mode.test.tsx` pins
 * the vocabulary one layer down and never names `object-grid`), so they share
 * one new file. `searchableFields` had `serverSearch.test.tsx`, whose ADR-0061
 * row really does pin the key's forwarding — a genuine near miss — but with a
 * SINGLE-member array and no arity row, so it was grown by the ordering,
 * empty-array and precedence rows before being registered. `batchActions` had
 * `bulkActionsSpecKey.test.tsx`, whose whole subject IS the alias precedence,
 * but both its fixtures are non-empty, so the nullish coalesce was unstated; it
 * was grown by the empty-array row before being registered.
 *
 * ⚠️ A member with no read site, handed back as a finding rather than frozen
 * into the pin — slice 9's choice, for slice 9's reason: the GROUPED pager
 * hard-codes its own rows-per-page choices and reads neither `pagination.pageSize`
 * nor `pagination.pageSizeOptions`, so an authored `pageSizeOptions` reaches the
 * flat pager and is dropped the moment `grouping` is authored. The pin asserts
 * the flat path and says so; an assertion that the grouped path ignores the
 * member would have to be deleted before anyone could make it read one.
 *
 * ⚠️ Unchanged by this slice: `NEWLY_JUDGED_UNPINNED_MEMBERS` (no block it names
 * was touched) and `record:related_list.actions`, whose `NO_READ_SITE_TO_PIN`
 * reading was not re-measured here either — slice 7's measurement still stands.
 *
 * ## 16 -> 13, the third bite out of `object-grid`, and its SOURCE-AND-DESTINATION layer
 *
 * The fourteenth slice takes three more `object-grid` keys — `aggregations`,
 * `dataSource` and `navigation` — so the ceiling follows in the same commit.
 * THREE and not the seven the block had left, on a measurement this seat
 * inherited rather than took: slice 12's dev refused a batch containing
 * `columns`, `filter`, `grouping` and `sort` because each is one slice on its
 * own, and slice 14's dispatch adopted that refusal. The three taken here are
 * what remains once those four are set aside, and they cluster: each names a
 * place OUTSIDE the block's own rows — where the rows come from (`dataSource`),
 * what a roll-up is computed over once they are grouped (`aggregations`), and
 * where a click goes (`navigation`) — so none of them is read anywhere near the
 * `dataTableSchema` fold slice 13 worked in.
 *
 * ⭐ The finding this slice's shape surfaced is that all three keys are read
 * through a PRECEDENCE the author cannot see, and each one resolves it
 * differently. `dataSource`'s members beat the block's own keys and the block's
 * own keys beat the view the binding named — three sources, one value.
 * `navigation`'s flags beat its own `mode`, and `openNewTab` discards the
 * sibling `view` on its way past. `aggregations` has no precedence at all and
 * instead disagrees with itself: `count` ignores the `field` member that the
 * other five types are entirely about.
 *
 * One of the three files is a PROMOTION AFTER GROWTH and two are NEW — the
 * distinction slices 1, 10, 11, 12 and 13 turned on. `dataSource` had
 * `ObjectGrid.elementDataSource.test.tsx`, whose whole subject IS the binding
 * and which drives the real renderer against a real adapter — a genuine near
 * miss — but its four cases covered `object`, `view` and `filter` and stated no
 * precedence for `sort` or `limit`, so it was GROWN by the pair rows before
 * being registered rather than credited as found. `aggregations` and
 * `navigation` had no file constraining their members at the grid:
 * `useGroupedData`'s own suites never name the block, and
 * `ObjectGrid.overlayShellModes-9299.test.tsx` — which does name it, and would
 * satisfy a string locator — asserts the four OVERLAY values of `mode` and no
 * other member, so it answers a narrower question than this key's.
 *
 * ⚠️ A member fact handed back rather than frozen into a pin, slice 9's choice
 * for slice 9's reason: an aggregation chip prints its `type` member and never
 * its `field` member, so two same-type roll-ups over different fields render as
 * two chips reading the same word. The pin asserts what renders and says so; an
 * assertion that the field NEVER appears would have to be deleted before anyone
 * could make it appear.
 *
 * ⚠️ Unchanged by this slice: `NEWLY_JUDGED_UNPINNED_MEMBERS` (no block it names
 * was touched) and `record:related_list.actions`, whose `NO_READ_SITE_TO_PIN`
 * reading was not re-measured here either — slice 7's measurement still stands.
 *
 * ## 13 -> 10, the first bite out of `object-master-detail-form`, and why the
 * seed pair could not be split
 *
 * The fifteenth slice takes three `object-master-detail-form` keys —
 * `initialData`, `initialValues` and `sections` — so the ceiling follows in the
 * same commit. The block is not closed: `dataSource`, `details` and `fields`
 * are left.
 *
 * ⭐ TWO of the three are one unit, and that is a reading rather than a
 * preference. This block's own registration calls `initialData` the "Alternate
 * spelling of `initialValues` the renderer also reads" and tells authors to
 * prefer `initialValues`; both are declared, both are forwarded, and neither
 * declaration says which one wins when both are authored. Pinning one without
 * the other would leave the PRECEDENCE — the cell an author actually trips on —
 * stated nowhere, so they share one file.
 *
 * ⭐ The finding this slice's shape surfaced is that none of the three keys has
 * a read site in this block at all. `MasterDetailForm`'s `parentSchema` memo
 * copies them KEY BY KEY onto an `object-form`-shaped object and renders it
 * through a DIRECTLY imported `<ObjectForm>` — no `SchemaRenderer`, no registry
 * lookup — so the member contract is the sibling block's, reached through a
 * hand-written map that can drop a key while every declaration still reads
 * correct. That is the same carrier whose omissions `object-form.sections`
 * records twice (objectui#9779, objectui#9834), which is why these pins are
 * taken at THIS block rather than delegated to the sibling's.
 *
 * Both files are NEW — the distinction slices 1, 10, 11, 12, 13 and 14 turned
 * on. Nothing constrained these keys' members at this block:
 * `MasterDetailForm.test.tsx` never authors either seed key,
 * `masterDetailFormTypeVocabulary.test.tsx` names the block and authors
 * `sections` — it would satisfy a string locator — but its subject is the
 * `formType` vocabulary and its sections fixture is a constant, so it states
 * nothing about what a member is.
 *
 * ⚠️ Two member facts handed back as findings rather than frozen into a pin,
 * slice 9's choice for slice 9's reason. (a) An EMPTY `initialData` shadows a
 * populated `initialValues` completely, because the resolution is `||` on the
 * OBJECT. (b) `fields` WAS declared "Ignored when `sections` is given" and
 * was not ignored: the parent field pool is built from `fields` first and a
 * section resolves against that pool, so the two INTERSECT and a section member
 * outside `fields` was dropped silently. Both were pinned as behaviour and
 * stated as limits; an assertion that either can never change would have to be
 * deleted before anyone could change it.
 *
 * ⭐ (b) has since been RULED, and is no longer a limit: objectui#9884 took
 * the DECLARATION as the wrong half. This block’s parent form is rendered by
 * the same `SimpleObjectForm` as `object-form` — the `parentSchema` memo named
 * above builds an `object-form`-shaped node — and `object-form`’s own `fields`
 * registration, like `form`’s and `embeddable-form`’s, declares the key as the
 * field selection with no such exemption, so honouring the exemption would have
 * falsified three declarations to satisfy one. The sentence was corrected, and
 * the SILENCE — the half that was a defect under either reading — was closed
 * with `warnSectionMemberExcludedByFields`, which names every drop the
 * intersection causes. The intersection itself stands and no rendered outcome
 * moved, so slice 15’s two DOM assertions are untouched; the
 * `object-master-detail-form.sections` entry above carries the current reading.
 * (a) is untouched and remains a limit.
 *
 * ⚠️ Unchanged by this slice: `NEWLY_JUDGED_UNPINNED_MEMBERS` (no block it names
 * was touched) and `record:related_list.actions`, whose `NO_READ_SITE_TO_PIN`
 * reading was not re-measured here either — slice 7's measurement still stands.
 *
 * ## 10 -> 8 (objectui#8071 slice 16) — and the objectui#8176 correction is SPENT
 *
 * `object-kanban.columns` and `object-kanban.dataSource` are pinned, which
 * CLOSES the block and empties `NEWLY_JUDGED_UNPINNED_MEMBERS`: all four
 * pre-existing declarations the raise above admitted are now judged by a pin
 * rather than by room. ⇒ the headroom that raise created no longer holds
 * anything, and the audit's second direction hardens from "only these four" to
 * "no lazily registered block may carry an exemption at all".
 *
 * ⚠️ Two of this block's grounds for being held back were STALE readings rather
 * than facts, and they were re-derived here rather than inherited. The contract
 * question objectui#8913 is RULED and LANDED (PR objectui#8989): `columns` is
 * declared on both faces as the protocol's union, so there is no pending ruling
 * a pin could be deleted by. The file-surface collision that held it at slice 6
 * was with a pull request that is long gone.
 *
 * ⚠️ `columns`' pin is the RENDERER half and is deliberately a second file, not
 * a promotion of objectui#8989's declaration pin: every assertion there is a
 * `safeParse`, and objectui#8068's criterion is the shape the renderer READS.
 * `dataSource`'s is a pre-existing file promoted after being read end to end
 * and grown by the five member dispositions it never stated — the `object`,
 * `filter`, `limit` and (loudest) the INERT `sort`.
 *
 * ⚠️ Unchanged by this slice: `record:related_list.actions`, whose
 * `NO_READ_SITE_TO_PIN` reading was not re-measured here either — slice 7's
 * measurement still stands.
 *
 * ## 8 -> 4 (objectui#8071 slice 17) — the `object-grid` block CLOSES
 *
 * `columns`, `filter`, `grouping` and `sort` are pinned, which takes the
 * largest block on this card to zero in its fourth bite. Set arithmetic:
 * -4 exemptions, -4 ceiling, +4 pins, and the remaining count equals this
 * constant, so the enumeration below it is the whole population rather than a
 * sample.
 *
 * ⚠️ Two of the four are PROMOTED pre-existing files rather than new ones, each
 * read end to end first and then grown by the member dispositions it never
 * stated — `gridFilterInputSpelling` by the three members of one rule,
 * `gridArrayArmOrderby-8973` by the two readers of `sort` that its own card
 * deliberately left alone. The other two are new, because nothing existing
 * stated the member SET for either.
 *
 * ⚠️ `columns` and `grouping` are separable but NOT disjoint — slice 16
 * measured that and this slice is where it shows: one memo derives the group
 * header labels from both keys, so `grouping`'s pin necessarily reads
 * `columns`. Both pins carry their own absent-member controls so a failure
 * still names one key.
 *
 * ⚠️ Two member facts are pinned as BEHAVIOUR and handed back as findings
 * rather than repaired here, the same choice slice 9 made and for the same
 * reason — an assertion that either can never change would have to be deleted
 * before anyone could change it. (a) The export door receives an
 * UNNORMALIZED `sort[].order`, so one authored value produces three answers
 * across this block's three readers. (b) The group-label memo reads
 * `columns[].options`, a member `ListColumnSchema` refuses at publish.
 *
 * ⚠️ Unchanged by this slice: `NEWLY_JUDGED_UNPINNED_MEMBERS` (already empty,
 * and no block it named was touched) and `record:related_list.actions`, whose
 * `NO_READ_SITE_TO_PIN` reading was not re-measured here either — slice 7's
 * measurement still stands.
 *
 * ## 4 -> 1 (objectui#8071 slice 18) — `object-master-detail-form` CLOSES,
 * and `AWAITING_A_PIN` goes with its last three entries
 *
 * `dataSource`, `details` and `fields` are pinned, which takes the last block
 * carrying the generic reason to zero. Set arithmetic: -3 exemptions,
 * -3 ceiling, +3 pins, and the remaining count equals this constant, so the
 * enumeration is the whole population: one entry,
 * `record:related_list.actions`.
 *
 * ⚠️ Two of the three are PROMOTED pre-existing files and one is new, and the
 * split follows what each file already stated. `MasterDetailForm.elementDataSource`
 * already fixed WHICH binding members this block honours, and was grown by
 * where the honoured one goes: it OUTRANKS the flat `objectName`, and it
 * reaches the DETAIL half (the derived child FK and the batch's parent leg).
 * It was also grown by the finding that "unmapped" is not "unread": a
 * malformed binding `filter` beside a named view withholds the whole form.
 * `topLevelFieldsWarnCoverage-8847` already pinned the `FormFieldSchema`
 * trap, and was grown by what a legal member IS. `details` is this block's
 * own half, and nothing stated its twelve members member by member, so its
 * pin is new.
 *
 * ⚠️ One member fact is pinned as BEHAVIOUR and handed back rather than
 * repaired here, the same choice slice 9 made and for the same reason:
 * `fields` bounds what the parent form DRAWS and not what its batch leg
 * WRITES, while the registration calls the key the parent pool for "the
 * submitted set".
 *
 * ⚠️ `AWAITING_A_PIN` was deleted in this commit. Its last entries were these
 * three, and a reason no entry carries says nothing (see the note where it
 * stood). The constant beside it, `AWAITING_A_PIN_NEWLY_JUDGED`, is kept,
 * because the objectui#8176 audit test still reads it.
 *
 * ⚠️ Unchanged by this slice: `record:related_list.actions`, whose
 * `NO_READ_SITE_TO_PIN` reading was not re-measured here. The one unit left
 * in this constant is that key's, and it moves only with the enforce-or-remove
 * decision the constant names, which the spec owns.
 *
 * ⇒ The rule for every future slice of objectui#8071: delete the entry, register
 * the pin, and set this constant to the new count. Not to the new count plus
 * room.
 *
 * ## 1 -> 7 (objectui#11073, the @objectstack/spec 17.5.0 bump) — the one rise
 * since the objectui#8176 correction, and it is a RULING, not room
 *
 * The six blocks 17.5.0 newly judges bring six array/object-armed inputs with
 * no pin. objectui#11111 decision 3 = B (record 5902351047) booked all six
 * OWED to objectui#11168 rather than pinning them in the bump. 1 (the
 * `NO_READ_SITE_TO_PIN` unit above) + 6 booked = 7, the exact count, and
 * `the objectui#11111 ledger is capped at exactly the entries it lists` pins
 * the six by name. objectui#11168's pins take this back to 1.
 *
 * ## 7 -> 5 (objectui#11168 slice 1, the `action:*` family) — the ruling paid down
 *
 * The slice registered member pins for `action:group.actions` and
 * `action:menu.actions` (the lists both containers draw and run themselves)
 * and deleted their two booked entries, so the ceiling follows the list down
 * in the same change. The four left are the `element:*` bookings, owed by the
 * card's later slices.
 *
 * ## 5 -> 4 (objectui#11163) — `record:related_list.actions` gets its read site
 *
 * The one unit that was not a booking — the `NO_READ_SITE_TO_PIN` key slice 18
 * left as this constant's whole remainder — moved the way its reason said it
 * would: with the enforce-or-remove decision the spec owns. The maintainer ruled
 * ENFORCE on objectstack-ai/objectstack#20665, `renderers/record-related-list.tsx`
 * reads the key, and the pin is registered. -1 exemption, -1 ceiling, +1 pin;
 * the constant is deleted with its entry. ⚠️ Not 1 -> 0 as the card was written:
 * the objectui#11111 bookings above landed between the card and this change, so
 * the four `element:*` units owed to objectui#11168 are what remain, and they
 * move only with that card.
 *
 * ## 4 -> 0 (objectui#11168 slice 2, the `element:*` pair) — the ruling paid off
 *
 * The slice registered member pins for `element:definition-list.items` and
 * `element:repeater`'s `fields`, `filter` and `sort`, measured through the
 * real renderer, and deleted their four booked entries. Nothing else stood in
 * the list, so the ceiling follows it to 0 and this direction now runs with no
 * exemption at all. A new array/object-armed key is answered with a pin.
 *
 * ## 0 -> 2 (objectui#11438, the @objectstack/spec 17.6.0 bump) — a RULING,
 * not room, the same rise the 17.5.0 bump took
 *
 * 17.6.0 newly judges `record:line_items`, which brings two array/object-armed
 * inputs with no pin: `columns` and `dataSource`. objectui#11438 ruling A′
 * (record 5965062249) applies objectui#11111 decision 3 = B to the bump, so
 * both are booked OWED to objectui#11536 rather than pinned in it. 0 + 2 booked
 * = 2, the exact count, and `the objectui#11111 ledger is capped at exactly the
 * entries it lists` caps the two and routes each to objectui#11536.
 * objectui#11536's pins take this back to 0.
 *
 * ## 2 -> 0 (objectui#11536) — the 17.6.0 ruling paid off
 *
 * The card registered member pins for `record:line_items.columns` and
 * `record:line_items.dataSource`, measured through the real renderer, and
 * deleted their two booked entries. The two array keys it declared beside them
 * (`filter`, `sort`) entered the population already pinned, so nothing stands
 * in the list and the ceiling follows it back to 0.
 *
 * ## 0 -> 6 (objectui#12971, the objectstack `main` pin bump) — a RULING, not
 * room, the rise the 17.5.0 and 17.6.0 bumps took
 *
 * The pin newly judges `list-view`, which brings six array/object-armed inputs
 * with no pin: `data`, `columns`, `filter`, `sort`, `options` and `dataSource`.
 * The seat decision D1 = A on objectui#12971 (record 6267645900) applies
 * objectui#11111 decision 3 = B to the bump, so all six are booked OWED to
 * objectui#13047. 0 + 6 booked = 6, and `the objectui#11111 ledger is capped
 * at exactly the entries it lists` caps the six and routes each to
 * objectui#13047, whose pins take this back to 0.
 *
 * ## 6 -> 0 (objectui#13047) — the objectstack `main` pin ruling paid off
 *
 * The card registered member pins for all six, measured through the real
 * `SchemaRenderer` and the `list-view` registration, and deleted their booked
 * entries. The structured keys it published beside them entered the
 * population already pinned, so nothing stands in the list and the ceiling
 * follows it back to 0.
 */
const MEMBER_PIN_EXEMPTION_CEILING = 0;

/**
 * Every test file a member pin can live in, as LAZY `?raw` loaders.
 *
 * Vite's glob, not `node:fs`, and that is a constraint rather than a taste: this
 * app's tsconfig is browser-only (`lib: ES2020, DOM`, `types` without `node`),
 * so a `node:fs` import passes under Vitest and fails the console's own `tsc` —
 * the trap `insecure-origin-crypto.placement.test.ts` and
 * `__tests__/helpers/preview-page-sources.ts` both record. It is also the better
 * instrument here: the glob is expanded against the real directory at transform
 * time, so the KEY SET alone answers "does this pin file still exist", which is
 * the failure this locator exists to catch.
 *
 * LAZY on purpose. `eager: true` would inline the raw text of every test file in
 * the repo — 2,000+ files, ~3 MB — into this module on every run of a gate that
 * already loads the whole registration graph. Lazy hands back loaders, so the
 * cost is the glob itself plus one read per REGISTERED pin (40 today).
 */
const PIN_SOURCES = import.meta.glob(
  [
    '../../../../packages/*/src/**/*.test.ts',
    '../../../../packages/*/src/**/*.test.tsx',
    '../../**/*.test.ts',
    '../../**/*.test.tsx',
  ],
  { query: '?raw', import: 'default' },
) as Record<string, () => Promise<string>>;

/** This file's own directory, repo-relative — the anchor the glob keys resolve against. */
const THIS_DIR = 'apps/console/src/__tests__';

/** A glob key (`../../../../packages/…`) as a repo-relative path. */
function repoPathOfGlobKey(key: string): string {
  const out: string[] = [];
  for (const segment of `${THIS_DIR}/${key}`.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

/** Pin sources by repo-relative path — the spelling `MEMBER_PINS` entries use. */
const PIN_SOURCE_BY_PATH = new Map<string, () => Promise<string>>(
  Object.entries(PIN_SOURCES).map(([key, load]) => [repoPathOfGlobKey(key), load]),
);

/** Vitest collects `*.test.ts` / `*.test.tsx`; anything else would never run. */
const IS_A_COLLECTED_TEST_FILE = /\.test\.tsx?$/;

/**
 * What is WRONG with one registered pin, or `null` when nothing is.
 *
 * Three failures, and each is a way a pin stops covering its key while the
 * registry entry still reads deliberate: the file was deleted, renamed or moved
 * out of the glob's reach; it is not a file the runner collects, so "pinned"
 * would not mean "executed"; or it does not mention this block and this key at
 * all, which is what an entry pointed at the wrong file looks like.
 *
 * The key match is word-boundaried. A substring match would accept `fields` for
 * `hideFields` — those two are pinned by the SAME file here, so the weaker form
 * would be satisfied by the wrong assertion.
 */
async function memberPinProblem(id: string, pin: MemberPin): Promise<string | null> {
  const [type, key] = splitExemptionKey(id);
  if (!IS_A_COLLECTED_TEST_FILE.test(pin.file)) {
    return `${id} -> ${pin.file}: not a *.test.ts(x) file, so the runner never collects it`;
  }
  const load = PIN_SOURCE_BY_PATH.get(pin.file);
  if (!load) {
    return `${id} -> ${pin.file}: no such pin file (deleted, renamed, or moved outside the glob)`;
  }
  const text = await load();
  if (!text.includes(type)) return `${id} -> ${pin.file}: pin file never names the block \`${type}\``;
  if (!new RegExp(`\\b${key}\\b`).test(text)) {
    return `${id} -> ${pin.file}: pin file never names the key \`${key}\``;
  }
  return null;
}

/** Ids with neither a pin nor an exemption — the new red. */
const unpinnedMembersOf = (type: string): string[] =>
  structuredInputsOf(type)
    .map((entry) => entry.id)
    .filter((id) => !(id in MEMBER_PINS) && !(id in MEMBER_PIN_EXEMPTIONS));

describe('registry `inputs` vs `@objectstack/spec` ComponentPropsMap (repo-wide)', () => {
  it('judges every spec-carried block that declares an authoring surface', () => {
    // Non-vacuity guard. Every per-block assertion below is generated from
    // `covered`; if the registration graph stopped loading, `covered` would be
    // empty and the whole suite would pass on nothing.
    expect(covered).toEqual(EXPECTED_COVERED);
  });

  it('pins the spec-carried blocks that are registered with no inputs', () => {
    expect(registeredWithoutInputs).toEqual(EXPECTED_WITHOUT_INPUTS);
  });

  it('accounts for every spec-carried block — judged, propless, or ledgered', () => {
    // THE ASSERTION objectui#8176 EXISTS FOR, and the one that turns this gate's
    // population from an accident into a statement.
    //
    // Every other assertion in this file is generated from `covered`. That makes
    // `covered` the gate's whole reach, and until this test there was nothing
    // anywhere saying what SHOULD be in it — only `EXPECTED_COVERED`, which
    // pins the set it happens to hold. A block that fell out of `covered` and
    // out of `registeredWithoutInputs` fell out of both pins at once and left no
    // trace: not judged, not counted as unjudged, not reported. Eight did,
    // measured on `origin/main` `0c8dbc492`.
    //
    // The three sets are now required to PARTITION `ComponentPropsMap`, so
    // absence is no longer expressible. A block leaving the judged population
    // has exactly one way to do it: a `UNJUDGED_SPEC_BLOCKS` entry, written by
    // hand, with a reason, in a diff someone reviews.
    const specBlocks = Object.keys(ComponentPropsMap).sort();
    const accounted = [
      ...covered,
      ...registeredWithoutInputs,
      ...Object.keys(UNJUDGED_SPEC_BLOCKS),
    ].sort();
    expect(
      specBlocks.filter((type) => !accounted.includes(type)),
      'spec-carried blocks this gate neither judges nor accounts for — add a ' +
        'UNJUDGED_SPEC_BLOCKS entry with the reason, or make them judgeable',
    ).toEqual([]);
    // …and the converse, so the ledger cannot name a block the spec dropped.
    expect(
      accounted.filter((type) => !specBlocks.includes(type)),
      'accounted for a block ComponentPropsMap does not carry',
    ).toEqual([]);
    // Exactly once each: a block may not be both judged and ledgered.
    expect(accounted, 'a block is accounted for twice').toEqual(specBlocks);
  });

  it('states the size of the population it judges', () => {
    // The census, in one place, as one readable object. Redundant with the exact
    // membership pins above BY CONSTRUCTION and kept anyway: the failure mode
    // objectui#8176 is about was never a wrong name, it was a population nobody
    // could see the size of. A reader (and a diff) gets all four numbers here.
    expect({
      specCarried: Object.keys(ComponentPropsMap).length,
      judged: covered.length,
      registeredPropless: registeredWithoutInputs.length,
      ledgeredUnjudgeable: Object.keys(UNJUDGED_SPEC_BLOCKS).length,
    }).toEqual({
      // 42 -> 45 on the `@objectstack/spec` 17.3.0 pin: the map grew by
      // `cloud-connection:panel`, `marketplace:installed-list` and
      // `mcp:connect-agent`, all three declared with an EMPTY shape, so all
      // three are ledgered rather than judged and 6 -> 9 is the same three
      // blocks counted on the other side of the partition. `judged` and
      // `registeredPropless` do not move, which is the check that the pin
      // added blocks rather than moving any across the partition (objectui#7122).
      //
      // 45 -> 55 on the `@objectstack/spec` 17.5.0 pin (objectui#11073): ten new
      // blocks. Six are judged (`MINOR_17_5_BLOCKS`, 29 -> 35); four are
      // registered lazily and unloaded here, booked OWED to objectui#11168 under
      // objectui#11111 decision 3 = B (9 -> 13). `registeredPropless` does not
      // move. 35 + 7 + 13 = 55.
      //
      // objectui#11168 slice 3 moves blocks ACROSS the partition, never into or
      // out of it: each block it loads leaves the ledger and is judged
      // (`MINOR_17_5_LOADED_BLOCKS`). `object-tree` and `object-map`: 35 -> 37
      // judged, 13 -> 11 ledgered. 37 + 7 + 11 = 55. Slice 4 loads
      // `object-gantt`: 37 -> 38 judged, 11 -> 10 ledgered. 38 + 7 + 10 = 55.
      // Slice 5 loads `object-timeline`, the last of the four: 38 -> 39 judged,
      // 10 -> 9 ledgered. 39 + 7 + 9 = 55.
      //
      // 55 -> 56 on the `@objectstack/spec` 17.6.0 pin (objectui#11438): one
      // new block, `record:line_items`, registered eagerly with `inputs`, so it
      // is judged (`MINOR_17_6_BLOCKS`, 39 -> 40) and its differences are
      // booked to objectui#11536 under objectui#11438 ruling A′.
      // `registeredPropless` and `ledgeredUnjudgeable` do not move.
      // 40 + 7 + 9 = 56.
      //
      // 56 -> 59 on the `@objectstack/spec` 18.0.0-next.0 pin (objectui#12030):
      // three new blocks, `record:approval_decision`, `record:approvals` and
      // `record:attachments`, each declared with an EMPTY shape, so all three are
      // ledgered (9 -> 12). `judged` and `registeredPropless` do not move.
      // 40 + 7 + 12 = 59.
      //
      // 59 -> 60 on the `@objectstack/spec` 18.0.0-next.3 pin (objectui#12873):
      // one new block, `record:json`, which this repo deliberately does not
      // register (its ledger entry says why), so it is ledgered (12 -> 13).
      // `judged` and `registeredPropless` do not move. 40 + 7 + 13 = 60.
      //
      // 60 -> 61 on the objectstack `main` pin after 18.0.0-next.3
      // (objectui#12971): one new row, `list-view`, registered eagerly with
      // `inputs`, so it is judged (`MINOR_18_MAIN_BLOCKS`, 40 -> 41). The same
      // pin retires `record:json` and `marketplace:installed-list`, whose rows
      // stay as refusal doors and whose ledger entries now read RETIRED
      // UPSTREAM, so `ledgeredUnjudgeable` does not move. 41 + 7 + 13 = 61.
      specCarried: 61,
      judged: 41,
      registeredPropless: 7,
      ledgeredUnjudgeable: 13,
    });
    // Non-vacuity, stated rather than implied by the numbers above.
    expect(covered.length).toBeGreaterThan(0);
  });

  it('no spec-carried block is registered but unloaded', () => {
    // The MECHANISM behind objectui#8176, asserted so it cannot come back
    // silently — and the reason the two eager plugin imports at the top of this
    // file are not merely a convenience.
    //
    // `getConfig` is loaded-only by design, so a block present only as a
    // `registerLazy` stub reads exactly like a block nobody registered: both
    // answer `undefined`. `hasLazy` is what tells them apart, and it is the one
    // question this file never asked. A block that answers YES here has a
    // declaration this gate is not reading — which is the whole defect, and the
    // reason objectui#7712 was invisible to a direction written to catch it.
    //
    // The remedy is an eager import, never a ledger entry: the declaration
    // exists and is reachable, so `UNJUDGED_SPEC_BLOCKS` would be a false
    // statement about it. `assertFullyLoaded` in `sdui-parser` makes the same
    // demand of manifest generation for the same reason.
    //
    // ⚠️ ONE RULED EXCEPTION, CAPPED: objectui#11111 decision 3 = B (record
    // 5902351047) booked the four lazily registered blocks 17.5.0 newly carries
    // OWED to objectui#11168, which loads and judges them. The expectation is
    // EXACTLY those booked entries, so a fifth unloaded block is still red, and
    // the owner card's landing takes this back to `[]`. Slices 3 to 5 loaded
    // them one block at a time, each leaving both this set and the ledger, and
    // with slice 5 the booked set is empty, so this expects `[]` again.
    const registeredButUnloaded = Object.keys(ComponentPropsMap)
      .filter((type) => ComponentRegistry.hasLazy(type))
      .filter((type) => ComponentRegistry.getConfig(type) === undefined)
      .sort();
    expect(
      registeredButUnloaded,
      'these blocks are registered lazily and this file has not loaded them, so ' +
        'their `inputs` are invisible to both directions — add an eager import ' +
        'of the owning plugin package alongside the two at the top of this file',
    ).toEqual(owedIdsOf(UNJUDGED_SPEC_BLOCKS));
  });

  it('every unjudged-block ledger entry still describes a block this gate cannot judge', () => {
    // The ledger's own rot check. An entry states WHY the block is unjudgeable,
    // and both reasons it may state are mechanically decidable — so an entry
    // that stops being true fails here instead of quietly excusing a block that
    // became judgeable.
    expect(Object.keys(UNJUDGED_SPEC_BLOCKS).length).toBeGreaterThan(0);
    for (const [type, reason] of Object.entries(UNJUDGED_SPEC_BLOCKS)) {
      expect(reason, `${type}'s ledger reason cites no issue`).toMatch(/#\d+/);
      expect(
        Object.keys(ComponentPropsMap),
        `${type} is ledgered but the spec no longer carries it — delete the entry`,
      ).toContain(type);
      if (reason.startsWith('RETIRED UPSTREAM')) {
        // Both halves, so neither can rot alone: the spec still retires the
        // type, and its kept row still accepts nothing.
        expect(
          isRetiredUpstream(type),
          `${type} is ledgered as retired upstream, and the spec does not retire it — ` +
            'give the entry its real reason, or judge the block',
        ).toBe(true);
        expect(
          specTopLevelKeys(type),
          `${type} is ledgered as retired upstream, and its row accepts keys — judge it`,
        ).toEqual([]);
        continue;
      }
      // objectui#10033: the other two reasons may not describe a retired type,
      // or a retirement leaves a reason in place that no longer says why.
      expect(
        isRetiredUpstream(type),
        `${type} is retired upstream, and its ledger reason does not say so — ` +
          'rewrite the entry as RETIRED UPSTREAM',
      ).toBe(false);
      if (reason.startsWith('EMPTY SPEC SHAPE')) {
        expect(
          specTopLevelKeys(type),
          `${type} is ledgered as having an empty spec shape, and it does not — ` +
            'it now has an authoring surface, so it must be judged',
        ).toEqual([]);
      } else if (reason.startsWith(OWED_PREFIX)) {
        // OWED (objectui#11111 decision 3 = B): still registered lazily and still
        // unloaded here. Loading it is the owner card's work, and the day that
        // lands this entry goes red and the block gets judged.
        expect(
          ComponentRegistry.hasLazy(type) && ComponentRegistry.getConfig(type) === undefined,
          `${type} is booked as registered lazily and unloaded here, and it no longer is — ` +
            'judge it and strike the entry',
        ).toBe(true);
      } else {
        // NOT REGISTERED, DELIBERATELY. `getKnownTypes` includes pending lazy
        // stubs on purpose: a stub is a registration, and satisfying this
        // assertion with one would be the exact blindness objectui#8176 is about.
        expect(
          ComponentRegistry.getKnownTypes(),
          `${type} is ledgered as deliberately unregistered, and something ` +
            'registers it — judge it instead',
        ).not.toContain(type);
      }
    }
  });

  it('the two lazily-registered blocks are judged, with a real declaration behind them', () => {
    // The instance pin behind the mechanism pin above.
    //
    // ⚠️ It deliberately does NOT assert `hasLazy` on these two, and the reason
    // is the same registry behaviour that makes the mechanism assertion exact:
    // `register()` DELETES the matching `lazyEntries` keys, so a stub that has
    // been loaded stops answering `hasLazy` at all. Measured, not assumed —
    // both answer false here, precisely because the eager imports at the top of
    // this file replaced their stubs. That is also why
    // `registeredButUnloaded` above can never name a loaded block: the two
    // conditions it ANDs are only ever true together for a stub still pending.
    //
    // What is asserted instead is the fact the blind spot hid: there is a real
    // declaration behind each of these names, with inputs, being judged. If a
    // future change drops the eager imports, the console's `registerLazy` stubs
    // come back, `hasLazy` starts answering true again, and the mechanism
    // assertion above reddens by name — which is the guard this instance pin
    // does not need to duplicate.
    // objectui#11168 slices 3 to 5's loads are the same instance, one pin later.
    for (const type of [...LAZY_REGISTERED_BLOCKS, ...MINOR_17_5_LOADED_BLOCKS]) {
      expect(
        (declaredInputs(type) ?? []).length,
        `${type} is registered without inputs, or its plugin package stopped ` +
          'being loaded by this file',
      ).toBeGreaterThan(0);
      expect(covered, `${type} is not being judged`).toContain(type);
    }
  });

  it('resolves a non-empty accepted key set for each covered block', () => {
    // Guards the derivation itself: if `specTopLevelKeys` ever stopped
    // resolving `.shape` (a Zod internals change, a `lazySchema` rework), it
    // would return `[]`, every input would read as off-spec, and the failure
    // would look like a repo-wide regression instead of a broken probe. An
    // empty result here means "fix the reader", not "fix the inputs".
    for (const type of covered) {
      expect(specTopLevelKeys(type).length, `${type} spec shape did not resolve`).toBeGreaterThan(0);
    }
  });

  it('the three former carve-out blocks now resolve a real shape', () => {
    // The tombstone of `SPEC_SHAPE_EMPTY_ON_THE_PIN` (see above). Keeping one
    // assertion on the three names is what stops the deletion being silently
    // undone by a future pin that regresses them to `EmptyProps` — the guard
    // above would then read as "the probe is broken" for all three at once,
    // which is the misdiagnosis objectui#4027 was filed about.
    for (const type of ['page:footer', 'page:section', 'page:sidebar']) {
      expect(covered, `${type} no longer declares inputs`).toContain(type);
      expect(specTopLevelKeys(type), `${type} regressed to an empty spec shape`).toContain('children');
    }
  });

  it('the tombstone premise still holds — a retired key stays IN the shape', () => {
    // THE PREMISE, asserted rather than assumed (objectui#3809). Every tombstone
    // filter in this file — in BOTH directions, since they share one accepted
    // set — is built on one property of ADR-0087 D2: retirement REPLACES the
    // member with `z.never().optional()` and leaves the entry listed. If
    // upstream ever retires by DELETING the key instead, the filter stops
    // narrowing anything and every assertion here goes on passing. That is dead
    // code nobody can see, and it is the failure mode objectui#3809's own text
    // warned about before the fix existed.
    //
    // So the shape of this assertion is deliberate: it is not "tombstones are
    // handled correctly", it is "there is still something for the handling to
    // do". A red here does not mean the gate is wrong; it means the premise
    // expired, and the filter plus this test plus the harvest comment above are
    // all now archaeology to be removed together.
    const listedButRejected = covered.flatMap((type) =>
      specTombstonedKeys(type).map((key) => `${type}.${key}`),
    );
    expect(
      listedButRejected.length,
      'no covered block lists a tombstoned key: either this pin predates every ADR-0087 D2 ' +
        'retirement, or upstream now DELETES retired keys — in which case the tombstone ' +
        'narrowing in `specTopLevelKeys` is dead code and must be removed, not kept',
    ).toBeGreaterThan(0);

    // …and the narrowing is not a no-op, per block. `listed` must strictly
    // exceed `accepted` exactly where a tombstone was found — the third way this
    // could rot is a judge that reports tombstones while the subtraction quietly
    // stops using its answer.
    for (const type of covered) {
      const tombstoned = specTombstonedKeys(type);
      if (tombstoned.length === 0) continue;
      expect(specListedKeys(type).length, `${type} accepted set did not narrow`).toBeGreaterThan(
        specTopLevelKeys(type).length,
      );
      for (const key of tombstoned) {
        expect(specListedKeys(type), `${type}.${key} is not even listed`).toContain(key);
        expect(specTopLevelKeys(type), `${type}.${key} survived the narrowing`).not.toContain(key);
      }
    }

    // Non-vacuity for the judge itself, in the direction the loops above cannot
    // reach: a probe that answered "tombstone" for EVERYTHING would satisfy all
    // of them. `page:card.title` is live contract and this repo publishes it, so
    // it is the control.
    expect(isShapeKeyTombstoned(specSchema('page:card'), 'title')).toBe(false);
    expect(specTopLevelKeys('page:card')).toContain('title');
  });

  it('the node-level key set is derived, discriminating, and not empty', () => {
    // Non-vacuity and calibration for the widening above, in both directions —
    // a reader that returned [] would silently stop widening (every gate-wrapped
    // block reds), and one that returned everything would stop being a gate.
    const nodeKeys = nodeLevelSpecKeys();
    expect(nodeKeys.length).toBeGreaterThan(0);
    // Accepted, and measured rather than assumed: `PageComponentSchema.safeParse`
    // keeps `dataSource` on a bare node and drops the two spellings the
    // objectui#6598 reporter tried instead.
    expect(nodeKeys).toContain('dataSource');
    expect(nodeKeys).toContain('className');
    // Refused — a per-block prop is not a node key, and neither is an invention.
    expect(nodeKeys).not.toContain('objectName');
    expect(nodeKeys).not.toContain('viewName');
    expect(nodeKeys).not.toContain('__not_a_spec_key__');
  });

  it.each(covered)('%s declares no top-level input the spec does not accept', (type) => {
    const exempt = new Set(exemptedFor(type));
    const unregistered = offSpecInputs(type).filter((name) => !exempt.has(name));
    expect(unregistered).toEqual([]);
  });

  it('every exemption names a real declared input on a covered block', () => {
    // A typo'd exemption key is worse than no exemption: it silently licenses
    // nothing while reading as deliberate cover for a real divergence.
    const dangling = Object.keys(OFF_SPEC_EXEMPTIONS).filter((key) => {
      const dot = key.indexOf('.');
      const type = key.slice(0, dot);
      const input = key.slice(dot + 1);
      return !covered.includes(type) || !(declaredInputs(type) ?? []).includes(input);
    });
    expect(dangling).toEqual([]);
  });

  it('every exemption states a reason and references a tracking issue', () => {
    const unjustified = Object.entries(OFF_SPEC_EXEMPTIONS)
      .filter(([, reason]) => !/#\d+/.test(reason))
      .map(([key]) => key);
    expect(unjustified).toEqual([]);
  });

  it('carries no stale exemption — a declared key must lose its entry', () => {
    // The half that keeps this list from becoming a permanent allowlist. Once
    // the spec declares an exempted key (upstream landing, or just a pin bump
    // for the `element:record_picker` trio), the entry stops describing
    // anything and has to be deleted in the same change that moves the pin.
    const stale = Object.keys(OFF_SPEC_EXEMPTIONS).filter((key) => {
      const dot = key.indexOf('.');
      const type = key.slice(0, dot);
      const input = key.slice(dot + 1);
      return !offSpecInputs(type).includes(input);
    });
    expect(stale).toEqual([]);
  });

  // ── the REVERSE direction (objectui#3808) ──────────────────────────────────
  //
  // Same `covered` set, same derived-not-restated expectations, same exemption
  // discipline — only the subtraction is turned round: spec keys minus declared
  // inputs, instead of declared inputs minus spec keys.

  it('every globally unpublished key is a real spec key on a covered block', () => {
    // Non-vacuity for the blanket exclusion. `aria` is subtracted from EVERY
    // block's expected surface, so a typo there (or the spec renaming the key)
    // would quietly stop excluding anything while still reading as a documented
    // decision — and, worse, would make the per-block assertion below start
    // demanding an `aria` input on fifteen blocks for a reason nobody wrote down.
    //
    // Non-empty FIRST: a `for` over an emptied map — and the reason check below —
    // both pass on nothing, so the map's own existence is the first assertion.
    expect(Object.keys(GLOBALLY_UNPUBLISHED_SPEC_KEYS).length).toBeGreaterThan(0);
    for (const key of Object.keys(GLOBALLY_UNPUBLISHED_SPEC_KEYS)) {
      const carriers = covered.filter((type) => specTopLevelKeys(type).includes(key));
      expect(carriers.length, `no covered block's spec declares "${key}"`).toBeGreaterThan(0);
    }
  });

  it('every globally unpublished key states a reason and references a tracking issue', () => {
    const unjustified = Object.entries(GLOBALLY_UNPUBLISHED_SPEC_KEYS)
      .filter(([, reason]) => !/#\d+/.test(reason))
      .map(([key]) => key);
    expect(unjustified).toEqual([]);
  });

  it.each(covered)('%s publishes every top-level key its spec props schema declares', (type) => {
    const exempt = new Set(unpublishedExemptedFor(type));
    const undiscoverable = undiscoverableSpecKeys(type).filter((key) => !exempt.has(key));
    expect(undiscoverable).toEqual([]);
  });

  it('every unpublished-key exemption names a key the spec really declares', () => {
    // The dangling check, in the reverse direction. Two ways to be wrong here,
    // and both read as deliberate cover while licensing nothing: a typo'd key,
    // and an entry for a block this gate does not judge.
    //
    // GA-pending entries are excluded only while the installed spec really does
    // not carry their key — the set of entries allowed to be dormant is pinned,
    // and the assertion below judges the dormancy itself.
    const dangling = Object.keys(UNPUBLISHED_EXEMPTIONS)
      .filter((key) => !isDormantOnThisPin(key))
      .filter((key) => {
        const [type, specKey] = splitExemptionKey(key);
        return !covered.includes(type) || !specTopLevelKeys(type).includes(specKey);
      });
    expect(dangling).toEqual([]);
  });

  it('every GA-pending exemption arms exactly with the installed spec, all ten together', () => {
    // The non-vacuity and self-arming half of `GA_PENDING_UNPUBLISHED_KEYS`.
    // Without it the pinned set could name keys no entry covers (licensing
    // nothing while reading as cover) or stay dormant forever on a GA tree that
    // dropped one of the keys — the two ways a "pending" mechanism rots.
    expect(GA_PENDING_UNPUBLISHED_KEYS.length).toBeGreaterThan(0);
    for (const key of GA_PENDING_UNPUBLISHED_KEYS) {
      expect(
        Object.keys(UNPUBLISHED_EXEMPTIONS),
        `${key} is pinned as GA-pending but has no exemption entry`,
      ).toContain(key);
      // Dormant exactly when the installed spec predates the GA element set,
      // live exactly when it carries it. An equality, not an implication, so
      // both regressions fail: a key GA dropped, and a key rc.6 somehow has.
      expect(
        isDormantOnThisPin(key),
        `${key} dormancy disagrees with the installed spec's element set`,
      ).toBe(!specCarriesGaBlocks);
    }
  });

  it('the four GA blocks enter coverage exactly when the installed spec carries them', () => {
    // The pin-dependence of `EXPECTED_COVERED`, asserted rather than assumed.
    // The registration half is pin-INDEPENDENT and checked first: all four are
    // registered with inputs by this repo on either pin, so a block dropping
    // out of `covered` can only ever mean the spec stopped carrying it — never
    // that a plugin quietly stopped registering an authoring surface.
    for (const type of GA_ONLY_BLOCKS) {
      expect(
        (declaredInputs(type) ?? []).length,
        `${type} is no longer registered with inputs in this repo`,
      ).toBeGreaterThan(0);
      expect(
        covered.includes(type),
        `${type} coverage disagrees with the installed spec`,
      ).toBe(type in ComponentPropsMap);
    }
    // Half-carried is a broken premise, not an in-between pin: they shipped in
    // one release, so `specCarriesGaBlocks` may not be a partial truth.
    const carried = GA_ONLY_BLOCKS.filter((type) => type in ComponentPropsMap);
    expect([0, GA_ONLY_BLOCKS.length]).toContain(carried.length);
  });

  it('the four GA blocks resolve their ruled split — declared vs carved out', () => {
    // objectui#4648's ruling, pinned by name rather than left to the derived
    // reverse-direction loop above, for exactly the reason the `#3808 / #3830`
    // and `rc.6 record_picker` pins next door exist: that loop goes green just as
    // readily if a declaration is REPLACED by an exemption, which is the cheap
    // move under time pressure and the one thing option B forbids. So the split
    // is asserted as "declared" and "exempted, not declared", not merely as
    // "not failing".
    //
    // Dormant on a pin that predates the GA element set — there is nothing to
    // judge when the spec carries none of the four — and the dormancy is not
    // silent: `the four GA blocks enter coverage exactly when the installed spec
    // carries them` above owns that fact for both pins.
    if (!specCarriesGaBlocks) {
      expect(covered.filter((type) => GA_ONLY_BLOCKS.includes(type))).toEqual([]);
      return;
    }

    // The carve-out, by name: `@deprecated` in this repo's own ObjectGridSchema,
    // declared by GA, and deliberately NOT published (maintainer 2026-08-16).
    // `defaultFilters` left with the `@objectstack/spec` 18 tombstone (objectui#12030).
    const CARVED_OUT_GRID_KEYS = [
      'fields',
      'pageSize',
      'selectable',
      'showPagination',
      'showSearch',
      'staticData',
      'title',
    ];

    for (const key of CARVED_OUT_GRID_KEYS) {
      expect(
        specTopLevelKeys('object-grid'),
        `spec no longer declares object-grid.${key} — re-check the carve-out`,
      ).toContain(key);
      expect(
        declaredInputs('object-grid') ?? [],
        `object-grid publishes ${key}; the ruling carved it out as a deprecated alias`,
      ).not.toContain(key);
      expect(
        Object.keys(UNPUBLISHED_EXEMPTIONS),
        `object-grid.${key} is carved out but carries no cited exemption`,
      ).toContain(`object-grid.${key}`);
    }

    // ⚠️ THE BOOKED KEYS — objectui#11438 ruling A″ (record 5968177777) booked
    // one, row 1 of the 17.6.0 bump, `object-grid.keyboardNavigation`, OWED TO
    // objectui#11068. That card's build published the key together with its
    // reader and struck the booking and this list together, as the booking
    // prescribed. The list stays, EMPTY, so an OWED entry on a GA block is
    // still red here whatever the ledger cap says: a booking admitted here is a
    // ruling's, by name, and none stands.
    const BOOKED_GA_KEYS: string[] = [];
    expect(
      owedIdsOf(UNPUBLISHED_EXEMPTIONS).filter((id) => GA_ONLY_BLOCKS.includes(splitExemptionKey(id)[0])),
      'an OWED entry on a GA block that objectui#11438 ruling A″ did not book — declare the key instead',
    ).toEqual(BOOKED_GA_KEYS);

    // Everything else the four blocks' spec schemas declare is DECLARED, and
    // carries no exemption. Stated as an exact set difference rather than a
    // spot-check so a key added by a later GA cannot slip through as neither.
    for (const type of GA_ONLY_BLOCKS) {
      const carved = type === 'object-grid' ? CARVED_OUT_GRID_KEYS : [];
      const booked = BOOKED_GA_KEYS.filter((id) => splitExemptionKey(id)[0] === type).map(
        (id) => splitExemptionKey(id)[1],
      );
      const shouldPublish = specTopLevelKeys(type)
        .filter((key) => !(key in GLOBALLY_UNPUBLISHED_SPEC_KEYS))
        .filter((key) => !carved.includes(key));
      const declared = new Set(declaredInputs(type) ?? []);
      expect(
        shouldPublish.filter((key) => !declared.has(key)),
        `${type} does not publish these spec keys, and they are not the ruled carve-out or the ` +
          'booked key — or a booked key is declared now, so strike its booking',
      ).toEqual(booked);
      expect(
        shouldPublish
          .filter((key) => !booked.includes(key))
          .filter((key) => Object.keys(UNPUBLISHED_EXEMPTIONS).includes(`${type}.${key}`)),
        `${type} exempts a key it declares — an exemption may not stand in for a declaration here`,
      ).toEqual([]);
    }
  });

  it('every unpublished-key exemption states a reason and references a tracking issue', () => {
    // The discipline that separates "deliberately not published, and here is who
    // owns the decision" from "we forgot". Four of the nine entries once here
    // existed only because objectui#3829 / #3830 / #3834 were opened to own
    // them, and #3830's is already gone — declaring the input is what retires an
    // entry, which is the point of the stale check below.
    const unjustified = Object.entries(UNPUBLISHED_EXEMPTIONS)
      .filter(([, reason]) => !/#\d+/.test(reason))
      .map(([key]) => key);
    expect(unjustified).toEqual([]);
  });

  it('carries no stale unpublished-key exemption — a published key must lose its entry', () => {
    // Keeps the reverse list from rotting the same way. An entry goes stale when
    // the block declares the input (objectui#3829/#3830/#3834 landing), when the
    // spec genuinely deletes the key, or — since objectui#3809 — when the spec
    // RETIRES it: a tombstone leaves the accepted set, so the reverse direction
    // stops demanding the key and any entry covering it stops describing
    // anything. That last arm is what harvested the eight entries named in the
    // comment above, and it is why no future retirement needs an issue of its
    // own to clean up after it.
    const stale = Object.keys(UNPUBLISHED_EXEMPTIONS)
      .filter((key) => !isDormantOnThisPin(key))
      .filter((key) => {
        const [type, specKey] = splitExemptionKey(key);
        return !undiscoverableSpecKeys(type).includes(specKey);
      });
    expect(stale).toEqual([]);
  });

  it('the objectui#8176 backlog has a ceiling — it may shrink, never grow', () => {
    // The transition list's other half, and the reason a "dozens" case is
    // survivable at all. The stale check above forces an entry OUT once its key
    // is declared; without a ceiling nothing stops the cheap move in the other
    // direction — greening a fresh divergence on these two blocks by writing a
    // nineteenth entry instead of declaring the input.
    //
    // ZERO again since objectui#8652 declared the `navigation` pair the 17.5.0
    // bump had BOOKED to it (the last two rows of the table below). `object-calendar`
    // publishes all nine keys its spec row declares; `object-kanban` publishes
    // thirteen of fourteen, and the fourteenth is RULED rather than owed —
    // objectui#8313 emptied the board, objectui#8314 emptied the calendar, and
    // objectui#8201's slice 2 ruled what was left.
    // ⚠️ Measured at @objectstack/spec 17.4.0, which is NOT the pin the card
    // was filed on: 17.4.0 added `object-kanban.limit` (objectstack#16562, the
    // option-A ruling on objectui#8172), so the block's spec row went 13 keys
    // to 14 and the declaration followed it in the same release. A reader
    // checking this arithmetic against the card's own 13 will not reproduce it. The number has come down five times and every step was
    // this ceiling's paired EXIT — a declaration retiring its own cover —
    // rather than a re-derivation:
    //
    //   18  these blocks enter the population (objectui#8176)
    //   16  objectui#8186 lands objectui#7712's two `filter` declarations
    //   15  objectui#8223 lands objectui#8171's `object-calendar.sort`
    //    8  objectui#8201 lands its first slice — seven scalar-armed keys
    //    4  objectui#8313 lands its second — the four array/object-armed keys
    //        on `object-kanban`, each with the `MEMBER_PINS` entry objectui#8212
    //        made part of the same obligation
    //    1  objectui#8314 lands slice 2b — `object-calendar`'s `data`,
    //        `staticData` and `loading`, paying the same three-part obligation
    //        for its two array-armed keys; `MEMBER_PIN_EXEMPTION_CEILING` did
    //        not move on either card
    //    0  objectui#8201 slice 2 lands the PM's Q1 = A ruling on the last
    //        entry — `object-kanban.quickAdd` becomes a RULED CARVE-OUT and
    //        moves into `LAZY_BLOCK_RULED_CARVE_OUTS`
    //    0  the `@objectstack/spec` 17.5.0 bump carries objectui#8285's ruled
    //        retirement: the carve-out's entry is harvested and the list
    //        empties (objectui#11073) — the MAP is now empty on these blocks too
    //    2  the same bump: 17.5.0 declares `navigation` on both blocks, and
    //        objectui#11111 decision 3 = B (record 5902351047) BOOKED the two
    //        keys OWED to objectui#8652 instead of declaring them in the bump.
    //        The only step UP this ceiling has taken, and it is a ruling, not
    //        headroom: the cap is exactly the two booked entries, and
    //        objectui#8652's landing takes it back to 0.
    //    0  objectui#8652 lands: `navigation` is declared on both blocks'
    //        `inputs`, each with the `MEMBER_PINS` entry objectui#8212 made
    //        part of the same obligation — the booked pair's paired exit.
    //
    // ⚠️ THE LAST STEP IS THE ONLY ONE THAT IS NOT A DECLARATION, and reading
    // it as one would be the wrong lesson. Every step above was this ceiling's
    // paired exit: an input got declared and its cover went stale. The step to
    // ZERO is a RULING — the entry is still here, still covering a real
    // undeclared key, and it left the BACKLOG rather than the map. The backlog
    // is what someone still owes; a ruled carve-out is owed by nobody.
    //
    // ⚠️ The prose that stood here read "Sixteen … ten on `object-kanban`, six
    // on `object-calendar`" while both assertions already read 15: objectui#8223
    // moved the numbers and not the sentence describing them. Corrected in
    // passing, and worth a line because a stale count here is exactly the kind
    // of drift that makes a reader distrust the assertions instead of the prose.
    // Both numbers and both sentences moved together on objectui#8313 and
    // again on objectui#8314.
    //
    // A new divergence on these blocks is a plain defect and gets declared,
    // exactly as it would on any other covered block.
    //
    // ⚠️ THE ONE KEY LEFT MAY NOT LEAVE BY A DECLARATION AT ALL, and it is now
    // RULED rather than pending — so the backlog this number counts is EMPTY
    // while the map below still carries an entry. Those are two different
    // statements and the next reader must not collapse them.
    // `object-kanban.quickAdd` is measured NOT honoured by this renderer
    // (objectui#8201): `KanbanImpl` gates the control on `quickAdd &&
    // onQuickAdd`, and no producer on the `ObjectKanban` path supplies that
    // runtime slot. Its disposition was the PRODUCT ruling that card escalated
    // rather than guessed, and the PM answered it: PREMATURE (Q1 = A,
    // 2026-09-07) — the renderer does not honour it and objectui#8285 owns the
    // fix. ⭐ Which of the two happened, as this comment used to demand of
    // whoever lowered the number: PREMATURE, not permanent. The distinction is
    // load-bearing rather than decorative — PREMATURE commits nobody to
    // building quick-add, and it also refuses the stronger claim that the
    // object-bound board is not going to grow it, which nothing measured
    // supports and which the sibling `KanbanRenderer` host contradicts by
    // honouring the same `quickAdd` + `onQuickAdd` pair by identity.
    // The ruling is recorded as data in `LAZY_BLOCK_RULED_CARVE_OUTS` above,
    // not as prose here, and `the one ruled carve-out on a newly judged block
    // is real` keeps that record honest in three directions.
    //
    // ⚠️ BOTH assertions below carry the ceiling and BOTH must move together.
    // The `toBe` is EXACT in both directions on purpose, so the card that lands
    // a declaration lowers this number in the same change; lowering only the
    // `toBe` would leave `toBeLessThanOrEqual` banking headroom the ratchet
    // exists to refuse.
    const backlog = Object.keys(UNPUBLISHED_EXEMPTIONS)
      .filter((key) => LAZY_REGISTERED_BLOCKS.includes(splitExemptionKey(key)[0]))
      .filter((key) => !LAZY_BLOCK_RULED_CARVE_OUTS.includes(key));
    expect(
      backlog.length,
      'a new unpublished-key exemption was added on a block objectui#8176 newly ' +
        'judged — declare the input at its registration site instead; the ' +
        'backlog list is shrink-only',
    ).toBeLessThanOrEqual(0);
    // Lower it here when the owning cards land, so the ceiling keeps ratcheting
    // rather than banking the headroom their fixes free up.
    expect(
      backlog.length,
      'the objectui#8176 backlog shrank — lower the ceiling above to match, in ' +
        'the same change that declared the input',
    ).toBe(0);
    // …and it is empty BY NAME, so the room objectui#8652's landing freed
    // cannot be spent on a different key.
    expect(backlog.sort(), 'the backlog is not empty').toEqual([]);
  });

  it('the one ruled carve-out on a newly judged block is real, and names its exit', () => {
    // The three assertions `LAZY_BLOCK_RULED_CARVE_OUTS`' docblock promises.
    // Subtracting from a ratchet is only safe if the subtrahend is itself
    // pinned, non-vacuous, and unable to drift into the stronger claim the PM
    // ruling refused — otherwise this list is a better hiding place than the
    // entry it adjusts, which would make the ceiling worse than leaving it
    // alone.
    //
    // 1. PINNED BY NAME. Growing the list has to be a visible edit to a
    //    literal, never a side effect of writing one more exemption.
    //    EMPTY since the 17.5.0 bump harvested `object-kanban.quickAdd`
    //    (objectui#11073) — the exit this list named, landed upstream.
    expect(
      [...LAZY_BLOCK_RULED_CARVE_OUTS].sort(),
      'a ruled carve-out was added on a newly judged block — a ruling is a ' +
        'maintainer or PM decision on the record, so name it here and cite it',
    ).toEqual([]);

    for (const id of LAZY_BLOCK_RULED_CARVE_OUTS) {
      const [type] = splitExemptionKey(id);
      // 2. NON-VACUOUS, both halves. The id must cover a real entry, and that
      //    entry must sit on a block this ceiling actually counts — otherwise
      //    the subtraction reaches somewhere it was never argued for.
      expect(
        Object.keys(UNPUBLISHED_EXEMPTIONS),
        `${id} is ruled but carries no exemption entry — if the entry was ` +
          'deleted (the upstream retirement landing), empty this list in the ' +
          'same change',
      ).toContain(id);
      expect(
        LAZY_REGISTERED_BLOCKS,
        `${id} is not on a block this ceiling counts, so ruling it here ` +
          'subtracts from a population it was never part of',
      ).toContain(type);
      // 3. IT NAMES ITS OWNING CARD — the mechanical difference between
      //    PREMATURE (an open card owns the fix) and the stronger claim the
      //    ruling refused (which would need no card and would have closed
      //    objectui#8285 as not-planned). An entry that stopped naming the card
      //    would have become that stronger claim silently.
      expect(
        UNPUBLISHED_EXEMPTIONS[id],
        `${id} is ruled PREMATURE but its reason no longer names objectui#8285, ` +
          'the card that owns the fix — a premature carve-out without an owning ' +
          'card is the permanent one, which is not what was ruled',
      ).toContain('objectui#8285');
    }
  });

  it('the harvested tombstoned keys are recognised, not exempted — and not published either', () => {
    // The pin the harvest leaves behind (objectui#3809). Deleting eight
    // exemptions is only half the change: the derived assertions above would go
    // green just as readily if a future edit RE-EXEMPTED one of these keys, or
    // if the tombstone narrowing stopped working and the entry came back to
    // absorb the red again. Both moves restore the exact state this issue
    // existed to end, and neither shows up as a failure anywhere else — which is
    // the same reason the `#3808 / #3830` and `rc.6 record_picker` pins next door
    // are written by name.
    //
    // Seven upstream retirements, ten keys, several facts each (eight through
    // 17.4.0; `object-kanban.quickAdd` joined at 17.5.0, and
    // `object-grid.resizableColumns` at 17.7.0). The list is
    // pin-dependent by construction and that is the point: it is the measurement
    // (`@objectstack/spec@17.0.0`, and the same eight on the rc.6 that preceded
    // it — this change was verified on both), so a pin that un-retires one of
    // them fails HERE, naming the key, instead of resurfacing as an unexplained
    // red in a derived loop.
    const HARVESTED: Array<[string, string]> = [
      ['element:record_picker', 'displayField'],
      ['element:record_picker', 'multiple'],
      ['element:record_picker', 'searchFields'],
      ['page:card', 'actions'],
      ['page:card', 'body'],
      ['page:header', 'icon'],
      ['page:tabs', 'type'],
      ['record:details', 'layout'],
      // The ninth, harvested at the `@objectstack/spec` 17.5.0 bump
      // (objectui#11073): objectui#8285's ruled retirement, which emptied
      // `LAZY_BLOCK_RULED_CARVE_OUTS` in the same change.
      ['object-kanban', 'quickAdd'],
      // The tenth, harvested at the 17.7.0 bump (objectui#11717):
      // objectstack#21445 retired the legacy second spelling of `resizable`.
      ['object-grid', 'resizableColumns'],
      // Eleven more, harvested at the `@objectstack/spec` 18 bump (objectui#12030):
      // objectstack#11509 retired the element layer's flat query keys (the
      // binding's `dataSource` is the one door), and the grid's legacy base
      // filter with them.
      ['object-grid', 'defaultFilters'],
      ['element:number', 'object'],
      ['element:number', 'filter'],
      ['element:repeater', 'object'],
      ['element:repeater', 'filter'],
      ['element:repeater', 'sort'],
      ['element:repeater', 'limit'],
      ['element:record_picker', 'object'],
      ['element:record_picker', 'filter'],
      ['element:record_picker', 'sort'],
      ['element:record_picker', 'limit'],
      // Two more, harvested at the objectstack `main` pin after 18.0.0-next.3
      // (objectui#12971): objectstack#24394 retired a page action row's own
      // `patch` (the row runs the declared action its `name` names, whose
      // `patch` the route writes). These two were PUBLISHED, not exempted, so
      // the forward direction is what turned red, and the registry stopped
      // publishing them in the same change.
      ['action:button', 'patch'],
      ['action:icon', 'patch'],
    ];

    for (const [type, key] of HARVESTED) {
      // Still LISTED: the release knows the key. This is the assertion that
      // distinguishes "retired" from "this pin never had it", and without it the
      // three below would pass just as well on a key that simply does not exist.
      expect(specListedKeys(type), `${type} no longer lists ${key} at all`).toContain(key);
      expect(
        isShapeKeyTombstoned(specSchema(type), key),
        `${type}.${key} is listed but no longer reads as a tombstone — did upstream un-retire it?`,
      ).toBe(true);
      // Not demanded by the reverse direction any more, which is what made the
      // exemption unnecessary…
      expect(
        undiscoverableSpecKeys(type),
        `${type}.${key} is being demanded again; the narrowing is not being applied`,
      ).not.toContain(key);
      // …and not covered by one either.
      expect(
        Object.keys(UNPUBLISHED_EXEMPTIONS),
        `${type}.${key} is exempted again — a tombstone needs no cover`,
      ).not.toContain(`${type}.${key}`);
      // The other resolution the two directions exist to forbid: publishing the
      // key. The forward direction would red on it, but stating it here is what
      // makes THIS test the one place a reader learns both halves.
      expect(
        declaredInputs(type) ?? [],
        `${type} publishes ${key}, a key the contract rejects by name`,
      ).not.toContain(key);
    }

    // Completeness, derived rather than restated: no OTHER tombstoned key on a
    // covered block may carry an exemption. An entry for one would be dangling
    // (the checks above name it), but this states the rule positively so the
    // next retirement is not resolved by writing an entry that then has to be
    // harvested a second time.
    const exemptedTombstones = covered.flatMap((type) =>
      specTombstonedKeys(type)
        .filter((key) => Object.keys(UNPUBLISHED_EXEMPTIONS).includes(`${type}.${key}`))
        .map((key) => `${type}.${key}`),
    );
    expect(exemptedTombstones).toEqual([]);
  });

  // ── the ARM direction (objectui#4971) ──────────────────────────────────────

  it.each(covered)('%s declares no arm the spec refuses outright', (type) => {
    const unregistered = refusedArms(type).filter((id) => !(id in OFF_SPEC_ARM_EXEMPTIONS));
    const evidence = ARM_JUDGEMENTS.filter((judgement) => unregistered.includes(judgement.id))
      .map((judgement) => `${judgement.id} — ${judgement.evidence}`)
      .join('; ');
    expect(unregistered, evidence).toEqual([]);
  });

  it('judges a non-vacuous census — every covered block, every key, every arm', () => {
    // THE NON-VACUITY GUARD, and the verdict line objectui#4971 asked for. Every
    // per-block assertion above is generated from `ARM_JUDGEMENTS`; a walk that
    // resolved nothing — a registry that stopped loading, an `inputTypeArms`
    // that stopped seeing the array form, a `specTopLevelKeys` that returned
    // `[]` and skipped every key as off-spec — produces an EMPTY judgement list,
    // and `[] === []` is what every one of those assertions would then report.
    // So the census is asserted before anything is derived from it.
    const keysJudged = new Set(
      ARM_JUDGEMENTS.map((judgement) => `${judgement.type}.${judgement.input}`),
    );
    const exemptSlot = ARM_JUDGEMENTS.filter((j) => j.verdict === 'exempt-slot');
    const exemptEmptyEnum = ARM_JUDGEMENTS.filter((j) => j.verdict === 'exempt-empty-enum');
    const census =
      `blocks ${covered.length} · keys judged ${keysJudged.size} · arms judged ` +
      `${ARM_JUDGEMENTS.length} · exempt(slot — describes a child position, not a value) ` +
      `${exemptSlot.length} · exempt(enum arm with no declared members — admits nothing) ` +
      `${exemptEmptyEnum.length} · refused ${ARM_JUDGEMENTS.filter((j) => j.verdict === 'refused').length} ` +
      `· registered exemptions ${Object.keys(OFF_SPEC_ARM_EXEMPTIONS).length}`;

    expect(covered.length, census).toBeGreaterThan(0);
    expect(keysJudged.size, census).toBeGreaterThan(0);
    expect(ARM_JUDGEMENTS.length, census).toBeGreaterThan(0);

    // …and per block, which is the half a global count cannot see: a block whose
    // keys all stopped resolving would vanish from the walk while the totals
    // stayed comfortably non-zero.
    for (const type of covered) {
      expect(
        ARM_JUDGEMENTS.some((judgement) => judgement.type === type),
        `${type} contributed no arm judgement — ${census}`,
      ).toBe(true);
    }

    // The exact arms are NOT pinned here: they are a property of the
    // registrations, which `EXPECTED_COVERED` and the forward direction already
    // pin by name. What is pinned is that there is at least one arm per judged
    // key — the walk cannot report a key it judged nothing about.
    expect(ARM_JUDGEMENTS.length, census).toBeGreaterThanOrEqual(keysJudged.size);
  });

  it('the arm judge tells a refused KIND from a refused VALUE — objectui#4971 mutation 3b, by name', () => {
    // CALIBRATION, and the assertion that keeps this gate honest in BOTH
    // directions at once. Every other assertion in this section is satisfied by
    // a judge that never refutes anything, and the enum treatment above is
    // exactly the kind of rule that could quietly become that judge.
    //
    // Reading 1 — the card's own measurement. `page:card.title` is
    // `string | Record<string,string>`; a `'number'` arm on it is a value the
    // contract refuses, and adding one is the mutation that left all 856 tests
    // green before this gate existed. It must read as a KIND refusal.
    expect(specArmVerdict('page:card', 'title', 42)).toBe('refuses-kind');
    // …with the control that says the probe is not just refusing everything.
    expect(specArmVerdict('page:card', 'title', 'Account')).toBe('accepts');
    expect(specArmVerdict('page:card', 'title', { en: 'Account', 'zh-CN': '客户' })).toBe('accepts');

    // Reading 2 — the false red triage flagged, and the reason the exemption for
    // enum CONTRACTS is a rule and not a list. `record:quick_actions.variant` is
    // a spec enum declared with a `'string'` arm: the contract refuses a
    // representative string as a VALUE, and the coarse-kind ceiling
    // (`ComponentInput.type`, maintainer 2026-08-17) puts that outside what the
    // arm claims. A judge that read this as a kind refusal would condemn a
    // correct declaration.
    expect(specArmVerdict('record:quick_actions', 'variant', 'Account')).toBe('refuses-content');
    // …and the same key is proof the two readings cannot collapse into one:
    // whatever makes the enum arm survive must NOT be what lets `42` through.
    expect(specArmVerdict('record:quick_actions', 'variant', 42)).toBe('refuses-kind');

    // Reading 3 — a verdict is scoped to its own key. `element:number` requires
    // `object` and `aggregate`; a whole-parse boolean would call every arm on
    // the block invented because of two keys the probe never set.
    expect(specParser('element:number')?.safeParse({ prefix: 'US$' }).success).toBe(false);
    expect(specArmVerdict('element:number', 'prefix', 'US$')).toBe('accepts');
  });

  it('the probe vocabulary covers every arm a manifest can carry', () => {
    // An arm kind with no probe is an arm kind that is silently never judged —
    // `COARSE_ARM_PROBES[arm] ?? []` yields no verdicts, `some` over nothing is
    // false, and the judgement would be `refused` on no evidence. So the
    // vocabulary is compared against the manifest's own set rather than a copy:
    // an eleventh kind arriving upstream fails here, naming itself.
    const needsProbe = [...MANIFEST_INPUT_TYPES].filter(
      (arm) => arm !== 'enum' && !ARM_KINDS_WITHOUT_A_VALUE_CLAIM.has(arm),
    );
    expect(needsProbe.length).toBeGreaterThan(0);
    expect(needsProbe.filter((arm) => (COARSE_ARM_PROBES[arm] ?? []).length === 0)).toEqual([]);
    // The two kinds judged by another route, asserted so a deletion of either
    // branch shows up here rather than as silence.
    expect(MANIFEST_INPUT_TYPES.has('enum')).toBe(true);
    expect([...ARM_KINDS_WITHOUT_A_VALUE_CLAIM].every((arm) => MANIFEST_INPUT_TYPES.has(arm))).toBe(
      true,
    );
  });

  it('the exact enum branch is exercised — at least one enum arm with real members', () => {
    // The enum arm is the one judged EXACTLY rather than by kind, so it is the
    // one branch that could rot into dead code without any assertion noticing:
    // if no covered block declared an `enum` arm with members, the exact
    // comparison would run over nothing while the coarse rule kept the file
    // green. Derived, not pinned to a block — any enum arm keeps it alive.
    const enumArms = ARM_JUDGEMENTS.filter(
      (judgement) => judgement.arm === 'enum' && judgement.verdict !== 'exempt-empty-enum',
    );
    expect(enumArms.length, 'no covered block declares an enum arm with members').toBeGreaterThan(0);
  });

  it('every arm exemption names an arm a covered block really declares', () => {
    // Same reason as its key-name twins: a typo'd entry licenses nothing while
    // reading as deliberate cover for a real divergence.
    const declaredIds = new Set(ARM_JUDGEMENTS.map((judgement) => judgement.id));
    expect(Object.keys(OFF_SPEC_ARM_EXEMPTIONS).filter((id) => !declaredIds.has(id))).toEqual([]);
  });

  it('every arm exemption states a reason and references a tracking issue', () => {
    const unjustified = Object.entries(OFF_SPEC_ARM_EXEMPTIONS)
      .filter(([, reason]) => !/#\d+/.test(reason))
      .map(([id]) => id);
    expect(unjustified).toEqual([]);
  });

  it('carries no stale arm exemption — an arm the contract accepts must lose its entry', () => {
    // The half that stops this list becoming a permanent allowlist. Once either
    // side moves — the spec widening the key, or the declaration changing — the
    // entry stops describing anything and has to be deleted in the same change.
    const refused = new Set(ARM_JUDGEMENTS.filter((j) => j.verdict === 'refused').map((j) => j.id));
    expect(Object.keys(OFF_SPEC_ARM_EXEMPTIONS).filter((id) => !refused.has(id))).toEqual([]);
  });

  // ── the MEMBER direction (objectui#8067) ───────────────────────────────────

  it.each(covered)('%s declares no member kind the spec refuses outright', (type) => {
    const unregistered = refusedMembers(type).filter((id) => !(id in OFF_SPEC_MEMBER_EXEMPTIONS));
    const evidence = MEMBER_JUDGEMENTS.filter((judgement) => unregistered.includes(judgement.id))
      .map((judgement) => `${judgement.id} — ${judgement.evidence}`)
      .join('; ');
    expect(unregistered, evidence).toEqual([]);
  });

  it('judges a non-vacuous member census — real declarations, on real blocks', () => {
    // THE NON-VACUITY GUARD for this direction, and it has to be stricter than
    // the arm direction's. `of` is OPTIONAL: a walk that resolved nothing —
    // `inputTypeArms(input.of)` returning `[]` because the key stopped reaching
    // the registry, a `specTopLevelKeys` that skipped every key as off-spec, a
    // serializer that dropped the field — produces an EMPTY judgement list, and
    // an empty list is INDISTINGUISHABLE from "no block declares members yet".
    // That is precisely the failure mode objectui#5905 recorded: a key written
    // everywhere and read by nothing, with every gate green. So the counts are
    // pinned as lower bounds rather than merely asserted non-zero.
    const keysJudged = new Set(
      MEMBER_JUDGEMENTS.map((judgement) => `${judgement.type}.${judgement.input}`),
    );
    const blocksJudged = new Set(MEMBER_JUDGEMENTS.map((judgement) => judgement.type));
    const census =
      `blocks with member declarations ${blocksJudged.size} · keys judged ${keysJudged.size} ` +
      `· member arms judged ${MEMBER_JUDGEMENTS.length} · witnessed ` +
      `${MEMBER_JUDGEMENTS.filter((j) => j.verdict === 'witnessed').length} · refused ` +
      `${MEMBER_JUDGEMENTS.filter((j) => MEMBER_REFUSALS.has(j.verdict)).length} ` +
      `· registered exemptions ${Object.keys(OFF_SPEC_MEMBER_EXEMPTIONS).length}`;

    // The fifteen keys objectui#8067 derived from single-kind member contracts,
    // across ten blocks. A LOWER bound, not an equality: a new declaration that
    // this gate then judges is the direction this section exists to encourage,
    // and it should not have to edit a number to land. A declaration
    // DISAPPEARING is the regression, and that is what the bound catches.
    expect(keysJudged.size, census).toBeGreaterThanOrEqual(15);
    expect(blocksJudged.size, census).toBeGreaterThanOrEqual(10);
    expect(MEMBER_JUDGEMENTS.length, census).toBeGreaterThanOrEqual(keysJudged.size);
    // Every judgement must be a real verdict about the contract, not a skip.
    expect(
      MEMBER_JUDGEMENTS.filter((j) => j.verdict === 'witnessed').length,
      census,
    ).toBeGreaterThanOrEqual(15);
  });

  it('the member judge reds on the drift that started this — page:header.actions, by name', () => {
    // CALIBRATION, and the reason this section is not just three more green
    // assertions. Every other member assertion here is satisfied by a judge that
    // never refutes anything; this one asserts the refutation, on the key whose
    // drift the card was filed for.
    //
    // `ComponentPropsMap['page:header'].actions` is `z.array(z.string())` —
    // "Action IDs". The declaration says `of: 'string'`, and that must be
    // witnessed…
    expect(specMemberVerdict('page:header', 'actions', 'array', 'Account')).toBe('accepts');
    // …while `of: 'object'` — the members the renderer actually read for the
    // whole life of the drift, and the exact mutation the ablation for this card
    // applies — must read as a KIND refusal at the MEMBER position. Before this
    // section existed there was no declaration to make and nothing to compare
    // it with, which is why the gate stayed green.
    expect(specMemberVerdict('page:header', 'actions', 'array', { id: 'clone' })).toBe(
      'refuses-kind',
    );
    expect(specMemberVerdict('page:header', 'actions', 'array', 42)).toBe('refuses-kind');

    // The container-level control, which is what tells a member refusal from the
    // top-level refusal the ARM direction already covered: the ARRAY itself is
    // perfectly acceptable on this key. A judge that simply refused everything
    // would pass the two assertions above and fail this one.
    expect(specArmVerdict('page:header', 'actions', [])).toBe('accepts');

    // …and the second half of the calibration: a CONTENT refusal at the member
    // position is NOT a kind refusal, so the coarse-kind ceiling survives one
    // level down exactly as it does at the top.
    //
    // `record:activity.types` was a CLOSED `z.enum([...])` of strings when this
    // row was written, and it probed that enum with an unlisted word.
    // `@objectstack/spec` 17.3.0 made the vocabulary OPEN —
    // `z.array(z.union([FeedItemType, z.string().min(1)]))`, objectstack#11658
    // executing the maintainer's 2026-08-24 ruling on objectstack#11507 — so no
    // ordinary string is refused there any more and the unlisted word ACCEPTS.
    // The widening kept exactly ONE content refusal, and it is the one this
    // control needs: `''` IS a string, so the only check it fails is `.min(1)`
    // and it raises no `invalid_type` anywhere — right KIND, wrong CONTENT.
    // That is exactly the distinction from the `42` line below, which is
    // refused for its KIND, and it is why the pair still discriminates.
    // Re-pointed under the maintainer 2026-09-07 authorisation on objectui#8137.
    expect(specMemberVerdict('record:activity', 'types', 'array', '')).toBe(
      'refuses-content',
    );
    expect(specMemberVerdict('record:activity', 'types', 'array', 42)).toBe('refuses-kind');
  });

  it('a contract with no uniform member position is named, not silently skipped', () => {
    // The third verdict this level adds, calibrated by name because nothing in
    // the repository declares it today and an unexercised branch is a branch
    // that can be wrong for free.
    //
    // `record:related_list.add` is a named-shape `z.object({ ... })`, not a map:
    // it has no position where "every value is of kind K" is even a statement,
    // so a probe key it never declared is refused AT THE CONTAINER. That is not
    // a verdict about the member kind — it is the absence of a member position,
    // and `judgeMembers` reports a declaration resting on one rather than
    // passing it.
    expect(specMemberVerdict('record:related_list', 'add', 'object', 'Account')).toBe(
      'no-member-position',
    );
    // …and the control: the same block's `columns` IS a container with a member
    // position, so the verdict above is about the contract's shape and not about
    // the probe machinery.
    expect(specMemberVerdict('record:related_list', 'columns', 'array', 'name')).toBe('accepts');
    // The other half of the same fact: a MAP contract judges the value under
    // whatever key it is given, so the probe key is not refused there.
    expect(specMemberVerdict('object-form', 'initialValues', 'object', 'Account')).toBe('accepts');
  });

  it('member declarations are derived from single-kind member contracts', () => {
    // The rule `ComponentInput.of` states, asserted rather than trusted: a key
    // is declared when the contract accepts exactly ONE coarse member kind, and
    // left alone when it accepts several. Both halves matter — the first is what
    // makes a declaration underivable-by-hand and therefore checkable, and the
    // second is what keeps this change from advertising member shapes only a
    // per-block pin can vouch for.
    const KINDS = ['string', 'number', 'boolean', 'array', 'object'] as const;
    // `refuses-content` COUNTS, and objectui#8204 asked whether that is intended
    // rather than the same defect one level up. It is intended, it is the same
    // fold `judgeMembers` and the arm direction already make, and it is
    // load-bearing in a way that is measurable: `refuses-content` means the
    // contract took the value's KIND and then refused its VALUE, which is
    // exactly what "the contract admits members of this kind" means at the
    // coarse-kind ceiling this file judges by.
    //
    // Dropping the fold would not have fixed objectui#8204 — it would have
    // broken the case the ceiling exists for. MEASURED on `@objectstack/spec`
    // 17.2.0, where `record:activity.types` is a bare `z.enum([...])` of
    // strings: every string probe is refused, `'Account'` among them, as
    // `invalid_value` — so an `accepts`-only reading answers `{}` for a key
    // whose `of: 'string'` was derived from that very enum, and this block's
    // one-kind assertion reds on a declaration that is right.
    //
    // The fold was never the leak; it was the amplifier. It only ever admitted
    // a kind the contract refuses while `refusesKind` was MIS-REPORTING a kind
    // refusal as a content one (the union-branch reading fixed on this card),
    // and with that reading corrected `refuses-content` again means what it
    // says.
    const acceptedMemberKinds = (type: string, key: string): string[] =>
      KINDS.filter((kind) =>
        (COARSE_ARM_PROBES[kind] ?? []).some((probe) => {
          const verdict = specMemberVerdict(type, key, 'array', probe);
          return verdict === 'accepts' || verdict === 'refuses-content';
        }),
      );

    // Every declared member arm is the contract's single accepted kind…
    const declaredAgainstContract = MEMBER_JUDGEMENTS.filter(
      (judgement) => judgement.verdict === 'witnessed',
    ).map((judgement) => {
      const accepted = acceptedMemberKinds(judgement.type, judgement.input);
      return `${judgement.id} → contract accepts {${accepted.join(',')}}`;
    });
    expect(
      declaredAgainstContract.filter((row) => !/→ contract accepts \{[a-z]+\}$/.test(row)),
      declaredAgainstContract.join('; '),
    ).toEqual([]);

    // …and the keys left undeclared for a member UNION are pinned with their
    // reason, so "no declaration" and "no declaration for a reason" stay
    // different facts. A stale entry fails: once the contract collapses to one
    // kind, the key becomes derivable and the entry must be deleted.
    for (const [id, reason] of Object.entries(MULTI_KIND_MEMBER_CONTRACTS)) {
      const [type, key] = splitExemptionKey(id);
      expect(reason.length, id).toBeGreaterThan(40);
      expect(reason, id).toMatch(/objectui#\d+/);
      expect(declaredInputs(type) ?? [], id).toContain(key);
      expect(acceptedMemberKinds(type, key).length, `${id} — ${reason}`).toBeGreaterThan(1);
      expect(
        MEMBER_JUDGEMENTS.some((judgement) => judgement.type === type && judgement.input === key),
        `${id} is pinned as a member union yet declares an \`of\` — delete the entry`,
      ).toBe(false);
    }
  });

  it('every member exemption names a member arm a covered block really declares', () => {
    const declaredIds = new Set(MEMBER_JUDGEMENTS.map((judgement) => judgement.id));
    expect(Object.keys(OFF_SPEC_MEMBER_EXEMPTIONS).filter((id) => !declaredIds.has(id))).toEqual([]);
  });

  it('every member exemption states a reason and references a tracking issue', () => {
    for (const [id, reason] of Object.entries(OFF_SPEC_MEMBER_EXEMPTIONS)) {
      expect(reason.length, id).toBeGreaterThan(40);
      expect(reason, id).toMatch(/objectui#\d+|objectstack#\d+/);
    }
  });

  it('carries no stale member exemption — a member kind the contract accepts must lose its entry', () => {
    const refused = new Set(
      MEMBER_JUDGEMENTS.filter((j) => MEMBER_REFUSALS.has(j.verdict)).map((j) => j.id),
    );
    expect(Object.keys(OFF_SPEC_MEMBER_EXEMPTIONS).filter((id) => !refused.has(id))).toEqual([]);
  });

  it('the five A-class keys objectui#3808 / #3830 declared are discoverable, block by block', () => {
    // Named, not just covered by the derived loop above. The derived assertion
    // would also pass if these five were added to `UNPUBLISHED_EXEMPTIONS`
    // instead of declared — which is precisely the move #3808 exists to rule
    // out — so the keys it fixed are pinned by name, and pinned as DECLARED
    // rather than merely "not failing".
    //
    // The fifth is objectui#3830's `element:record_picker.filter`, the A-class
    // key #3808's own triage dropped between its raw key dump and its three
    // lists. It is listed HERE, in the same place as the other four, because it
    // is the same fact about the same gate: the entry that used to exempt it
    // (deleted above) is not evidence of anything once the input exists, and a
    // future change that dropped the declaration and re-added the exemption
    // would restore the gap while leaving every derived assertion green.
    //
    // `element:record_picker.filter` left this list at the `@objectstack/spec` 18
    // bump (objectui#12030): the spec retired it as a tombstone (objectstack#11509),
    // and the registration stopped publishing it in the same change, so it is
    // pinned with the other harvested tombstones now, as published-NOT.
    const fixed: Array<[string, string]> = [
      ['record:details', 'hideFields'],
      ['record:related_list', 'relationshipValueField'],
      ['record:related_list', 'add'],
      ['element:text_input', 'defaultValue'],
    ];
    for (const [type, key] of fixed) {
      expect(specTopLevelKeys(type), `${type} spec no longer declares ${key}`).toContain(key);
      expect(declaredInputs(type) ?? [], `${type} does not publish ${key}`).toContain(key);
      expect(Object.keys(UNPUBLISHED_EXEMPTIONS)).not.toContain(`${type}.${key}`);
    }
  });

  it('the one key the rc.6 bump added to element:record_picker that is still live is discoverable', () => {
    // objectui#4167, and pinned by name for exactly the reason the five above
    // are: the derived reverse-direction assertion would go green just as
    // readily if these three were added to `UNPUBLISHED_EXEMPTIONS` instead of
    // declared, and "exempt it" is the cheaper move under time pressure. The
    // exemption that covered the retired `displayField` / `searchFields` /
    // `multiple` trio predicted this red in writing and called it "correct and
    // wanted"; this is what banking that prediction looks like.
    //
    // The first assertion is not redundant with the second. It is the
    // non-vacuity half: if a later pin dropped these from
    // `ElementRecordPickerProps`, `undiscoverableSpecKeys` would stop naming
    // them and every derived assertion would pass while the inputs sat there
    // publishing keys the contract no longer has.
    //
    // `sort` and `limit` left this list at the `@objectstack/spec` 18 bump
    // (objectui#12030): both are tombstones there (objectstack#11509), unpublished
    // in the same change, and pinned with the other harvested tombstones.
    for (const key of ['emptyText']) {
      expect(
        specTopLevelKeys('element:record_picker'),
        `spec no longer declares element:record_picker.${key}`,
      ).toContain(key);
      expect(
        declaredInputs('element:record_picker') ?? [],
        `element:record_picker does not publish ${key}`,
      ).toContain(key);
      expect(Object.keys(UNPUBLISHED_EXEMPTIONS)).not.toContain(`element:record_picker.${key}`);
    }
  });

  it('the five GA keys objectui#4668 declared are discoverable, block by block', () => {
    // Named, not merely covered by the derived reverse loop above, for exactly
    // the reason the #3808 five and the rc.6 record_picker trio next door are:
    // that loop goes green just as readily if a declaration is REPLACED by an
    // `UNPUBLISHED_EXEMPTIONS` entry, which is the cheap move under time
    // pressure and the one thing these five may not resolve to a second time.
    // Their entries existed for a stated, expiring reason — the pre-GA pin — and
    // that reason cannot be re-borrowed now that the pin carries the keys.
    //
    // Three assertions per key, and the first is the non-vacuity half: if a
    // later pin dropped one of these from its props schema,
    // `undiscoverableSpecKeys` would stop naming it and every derived assertion
    // would pass while the input sat there publishing a key the contract no
    // longer has — the forward direction would then be the one to red, which is
    // the correct place for that failure, not here.
    const declared: Array<[string, string]> = [
      ['page:header', 'maxVisible'],
      ['page:header', 'mobileMaxVisible'],
      ['page:tabs', 'alwaysShowStrip'],
      ['record:details', 'inlineEdit'],
      ['record:details', 'showHeader'],
    ];
    for (const [type, key] of declared) {
      expect(specTopLevelKeys(type), `${type} spec no longer declares ${key}`).toContain(key);
      expect(declaredInputs(type) ?? [], `${type} does not publish ${key}`).toContain(key);
      expect(Object.keys(UNPUBLISHED_EXEMPTIONS)).not.toContain(`${type}.${key}`);
      // And they are no longer nameable as dormant: the set that licensed the
      // dormancy dropped them, so `isDormantOnThisPin` answers false for a
      // second, independent reason. Without this, re-adding the key to
      // `GA_PENDING_UNPUBLISHED_KEYS` *and* to the exemption map would restore
      // the pre-GA state and only `every GA-pending exemption arms exactly with
      // the installed spec` would notice — and only while the pin carries the
      // key.
      expect(GA_PENDING_UNPUBLISHED_KEYS).not.toContain(`${type}.${key}`);
    }

    // Each carries a description, because for these five the discoverability
    // IS the fix: an input with an empty description publishes the key to
    // `sdui.manifest.json` and the `.d.ts` while still telling a designer panel
    // nothing about what to write in it.
    for (const [type, key] of declared) {
      const input = (ComponentRegistry.getConfig(type)?.inputs ?? []).find((i) => i.name === key);
      expect(input, `${type}.${key} input vanished`).toBeTruthy();
      expect((input?.description ?? '').length, `${type}.${key} has no description`).toBeGreaterThan(0);
    }
  });

  it('the twelve rc.6-obsoleted off-spec exemptions are gone, and their keys are contract now', () => {
    // The tombstone for the emptied `OFF_SPEC_EXEMPTIONS` (see its comment).
    // Without this, "the list is empty" and "the list was accidentally deleted
    // along with the divergences it covered" look identical, and every forward
    // assertion passes either way — the same misdiagnosis objectui#4027 records
    // for the `SPEC_SHAPE_EMPTY_ON_THE_PIN` carve-out, which is why that one
    // also left an assertion behind rather than just a comment.
    //
    // Asserted as "the spec declares it AND the block publishes it", not merely
    // "no longer exempted": these twelve keys were author-reachable
    // configuration the renderers had always honoured, so a pin that regressed
    // any of them must fail here loudly rather than quietly re-open an
    // exemption-shaped hole.
    const settledUpstream: Array<[string, string]> = [
      ['page:header', 'recordChrome'],
      // `['page:header', 'showStar']` left with the input (objectui#12627):
      // the spec retires the key (objectstack#23650), so neither half of
      // "declared AND published" holds for it any more.
      ['page:header', 'showCopyId'],
      ['page:accordion', 'variant'],
      ['page:tabs', 'tabStyle'],
      ['element:record_picker', 'labelField'],
      ['element:record_picker', 'valueField'],
      ['element:record_picker', 'label'],
      ['page:card', 'children'],
      ['page:section', 'children'],
      ['page:footer', 'children'],
      ['page:sidebar', 'children'],
    ];
    for (const [type, key] of settledUpstream) {
      expect(specTopLevelKeys(type), `${type} spec no longer declares ${key}`).toContain(key);
      expect(declaredInputs(type) ?? [], `${type} stopped publishing ${key}`).toContain(key);
      expect(Object.keys(OFF_SPEC_EXEMPTIONS)).not.toContain(`${type}.${key}`);
    }
    // Empty since rc.6. The 17.5.0 bump booked `action:group.name` here under
    // objectui#11111 decision 3 = B; objectui#11168 slice 1 retired the input,
    // and with it the entry. Pinned empty, so nothing rides back in.
    expect(Object.keys(OFF_SPEC_EXEMPTIONS)).toEqual([]);
  });

  // ── the MEMBER-PIN direction (objectui#8068) ───────────────────────────────
  //
  // Same `covered` set and the same exemption discipline as the three
  // directions above. What moves is the SUBJECT once more: not which keys a
  // block publishes, nor with which kinds, but whether anything anywhere
  // constrains what is INSIDE an array element or a nested object.

  it('judges a non-vacuous member-shape census — every covered block, every array/object input', () => {
    // Non-vacuity FIRST, for the reason the arm census gives next door: every
    // assertion below is generated from `structuredInputs`, so a reader that
    // resolved nothing (a renamed `ComponentInput.type`, an `inputTypeArms`
    // that stopped recognising the array form) would empty the population and
    // turn the whole direction green on nothing at all.
    expect(structuredInputs.length).toBeGreaterThan(0);

    // The partition is TOTAL and DISJOINT: every member of the population is
    // either pinned or exempt, never both and never neither. Stated here as
    // well as per-block below because the per-block loop cannot see the
    // "both" case, which is the shape a stale exemption takes.
    const ids = structuredInputs.map((entry) => entry.id);
    expect(ids.filter((id) => id in MEMBER_PINS && id in MEMBER_PIN_EXEMPTIONS)).toEqual([]);
    expect(
      ids.filter((id) => !(id in MEMBER_PINS) && !(id in MEMBER_PIN_EXEMPTIONS)),
    ).toEqual([]);

    // Every arm the population was selected on is one of the two, so a widened
    // `STRUCTURED_ARMS` cannot quietly pull in scalars.
    for (const entry of structuredInputs) {
      expect(entry.arms.some((arm) => STRUCTURED_ARMS.has(arm)), entry.id).toBe(true);
    }
  });

  it.each(covered)('%s pins the member shape of every array/object input it declares', (type) => {
    // THE new red. A block that grows an array-typed key with no pin and no
    // exemption fails here, naming the key — which is the one thing that did
    // not happen for `page:header.actions` through an entire contract cycle.
    expect(unpinnedMembersOf(type)).toEqual([]);
  });

  it('the pin-source glob resolves against the right anchor', () => {
    // Self-location, and the one thing `THIS_DIR` cannot assert about itself. A
    // wrong anchor resolves every key to a path nothing matches, every pin then
    // reads as MISSING, and the resulting repo-wide red looks like 19 deleted
    // pins instead of one bad constant.
    //
    // NOT asserted on this file's own path: `import.meta.glob` excludes the
    // module that calls it, so `registry-inputs-spec-parity.test.ts` is never in
    // its own glob — measured, and the first shape of this control failed on it.
    // The two arms below are what actually discriminate. A `THIS_DIR` off by a
    // level still yields correct `packages/…` paths (the `..` walk bottoms out),
    // so the `./`-anchored half is the half that catches it.
    const resolved = [...PIN_SOURCE_BY_PATH.keys()];
    expect(resolved.length).toBeGreaterThan(0);
    // No key may still carry a `..`: that is the signature of an anchor the walk
    // could not consume, and it would silently match nothing forever after.
    expect(resolved.filter((path) => path.includes('..'))).toEqual([]);
    // The `./`-anchored half — this directory's own siblings land back in it.
    // Witnessed by a long-standing neighbour that is NOT a registered pin, on
    // purpose: naming a pin file here would make a DELETED PIN red this control
    // too, and "the anchor is broken" and "one pin is gone" are different
    // diagnoses that must not share a signal. A generic
    // `some(path.startsWith(THIS_DIR))` cannot do the job either — it compares
    // the anchor against itself and passes for any wrong value.
    expect(resolved).toContain(`${THIS_DIR}/public-contract.test.ts`);
    // …and the `../../../../`-anchored half reaches the packages. Generic here,
    // because a wrong anchor cannot produce a `packages/` prefix at all: the
    // `..` walk bottoms out at the repo root either way.
    expect(resolved.some((path) => path.startsWith('packages/'))).toBe(true);
  });

  it('every registered member pin points at a collected test file that names its block and key', async () => {
    // The locator, and the failure mode it exists for: a pin file deleted or
    // renamed leaves the key uncovered while its registry entry still reads
    // deliberate. Reported as one list so a sweep names every broken entry at
    // once rather than one per run.
    const problems = (
      await Promise.all(
        Object.entries(MEMBER_PINS).map(([id, pin]) => memberPinProblem(id, pin)),
      )
    ).filter((problem): problem is string => problem !== null);
    expect(problems).toEqual([]);
  });

  it('the locator discriminates — it is not a check that passes on any file', async () => {
    // Calibration for the check above, in the direction it cannot fail on its
    // own. A locator that matched everything would license every entry at once
    // and read exactly like a clean sweep, which is the false-negative shape
    // this card was dispatched to end. Every probe is aimed at a REAL registered
    // pin, so the control cannot pass by pointing at nothing.
    const real = MEMBER_PINS['page:header.actions'];
    expect(await memberPinProblem('page:header.actions', real)).toBeNull();

    // …a key that file never mentions is REFUSED,
    expect(await memberPinProblem('page:header.__objectui_8068_probe__', real)).toMatch(
      /never names the key/,
    );
    // …a block it never mentions is refused,
    expect(await memberPinProblem('__objectui_8068_block__.actions', real)).toMatch(
      /never names the block/,
    );
    // …a path with no file behind it is refused,
    expect(
      await memberPinProblem('page:header.actions', {
        file: 'packages/components/src/__tests__/__objectui_8068_absent__.test.tsx',
        pins: 'probe',
      }),
    ).toMatch(/no such pin file/);
    // …and a file that really exists but the runner would never collect is
    // refused too, which is what separates "present" from "executed".
    expect(
      await memberPinProblem('page:header.actions', { file: 'package.json', pins: 'probe' }),
    ).toMatch(/never collects it/);
  });

  it('the four keys objectui#8068 names are in the population, and all four are pinned', () => {
    // The calibration this whole direction is measured against. Three of these
    // are the keys the LIMIT note at the top of this file delegates to; the
    // fourth is the one that had no pin, drifted for a full contract cycle, and
    // was only ever caught by a human. If a future narrowing of the population
    // or the locator drops any of the four, the direction has stopped
    // describing the defect it was built for — and that must be loud, not a
    // shorter list nobody re-derives.
    const exemplars = [
      'record:details.sections',
      'record:highlights.fields',
      'record:related_list.add',
      'page:header.actions',
    ];
    const ids = new Set(structuredInputs.map((entry) => entry.id));
    for (const id of exemplars) {
      expect(ids, `${id} left the member-shape population`).toContain(id);
      expect(MEMBER_PINS[id], `${id} lost its pin`).toBeDefined();
      expect(Object.keys(MEMBER_PIN_EXEMPTIONS), `${id} was exempted instead of pinned`).not.toContain(id);
    }
  });

  it('every member pin names a key that is still array/object-armed on a covered block', () => {
    // Dangling, the same check the three lists above carry: a pin for a key
    // that changed kind, lost its declaration or left `covered` silently
    // licenses nothing while reading as coverage.
    const ids = new Set(structuredInputs.map((entry) => entry.id));
    expect(Object.keys(MEMBER_PINS).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('every member-pin exemption names a key that is still array/object-armed on a covered block', () => {
    const ids = new Set(structuredInputs.map((entry) => entry.id));
    expect(Object.keys(MEMBER_PIN_EXEMPTIONS).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('every member-pin exemption states a reason and references a tracking issue', () => {
    const unjustified = Object.entries(MEMBER_PIN_EXEMPTIONS)
      .filter(([, reason]) => !/#\d+/.test(reason))
      .map(([key]) => key);
    expect(unjustified).toEqual([]);
  });

  it('carries no stale member-pin exemption — a pinned key must lose its entry', () => {
    // The half that keeps the transition from becoming a permanent allowlist.
    // objectui#8071 converts these to pins one at a time, and this is what
    // demands the entry be deleted in the same change rather than left behind
    // as cover for a key that no longer needs any.
    expect(Object.keys(MEMBER_PIN_EXEMPTIONS).filter((id) => id in MEMBER_PINS)).toEqual([]);
  });

  it('the member-pin exemption list only ratchets DOWN', () => {
    // The other half. A new array-typed key must be answered with a pin, not
    // with a 51st entry carrying the same reason as its neighbours — that move
    // is what made the discipline voluntary in the first place, one layer in.
    expect(Object.keys(MEMBER_PIN_EXEMPTIONS).length).toBeLessThanOrEqual(
      MEMBER_PIN_EXEMPTION_CEILING,
    );
  });

  it('the ceiling correction admits exactly the four keys objectui#8176 made visible', () => {
    // The audit of the one number in this file that went up. The ceiling moved
    // 58 -> 62 because the population it was measured over was wrong, not
    // because four keys needed room — and the difference between those two
    // sentences is only checkable if the four are named.
    //
    // Both directions are asserted. Every named key must really be exempt (so
    // the list cannot claim credit for headroom it does not use), and every
    // exemption on a newly judged block must be one of the four (so a fifth
    // cannot ride in on the same correction).
    for (const id of NEWLY_JUDGED_UNPINNED_MEMBERS) {
      expect(
        Object.keys(MEMBER_PIN_EXEMPTIONS),
        `${id} is named as part of the objectui#8176 ceiling correction but is ` +
          'not exempt — delete it from the list and lower the ceiling',
      ).toContain(id);
      expect(
        MEMBER_PIN_EXEMPTIONS[id],
        `${id} carries the generic reason; it was not in objectui#8068's census`,
      ).toBe(AWAITING_A_PIN_NEWLY_JUDGED);
    }
    const onNewlyJudgedBlocks = Object.keys(MEMBER_PIN_EXEMPTIONS).filter((id) =>
      LAZY_REGISTERED_BLOCKS.includes(splitExemptionKey(id)[0]),
    );
    expect(
      onNewlyJudgedBlocks.sort(),
      'a member-pin exemption was added on a block objectui#8176 newly judged ' +
        'that is not part of the measured correction — it needs a pin, not room',
    ).toEqual([...NEWLY_JUDGED_UNPINNED_MEMBERS].sort());
  });

  it('the objectui#11111 ledger is capped at exactly the entries it lists', () => {
    // objectui#11111 decision 3 = B (record 5902351047): the 17.5.0 bump
    // re-pins and declares nothing, and every difference it surfaces is booked
    // to an owner card with an expiry — see `OBJECTUI_11111_LEDGER_CAPS`. This
    // is what keeps "booked" from becoming "unbounded": each ledger's booked
    // entries must number EXACTLY its cap (so one more is red, and a struck one
    // demands the cap come down with it), each must be routed to the card the
    // ruling names for it, and each must carry the ruling and its expiry.
    // objectui#11438 ruling A′ (record 5965062249) books the 17.6.0 bump's
    // `record:line_items` entries the same way, to objectui#11536, and ruling
    // A″ (record 5968177777) books row 1, `object-grid.keyboardNavigation`, to
    // objectui#11068.
    const ledgers: Array<[keyof typeof OBJECTUI_11111_LEDGER_CAPS, Record<string, string>]> = [
      ['unjudgedBlocks', UNJUDGED_SPEC_BLOCKS],
      ['offSpecInputs', OFF_SPEC_EXEMPTIONS],
      ['unpublishedKeys', UNPUBLISHED_EXEMPTIONS],
      ['refusedArms', OFF_SPEC_ARM_EXEMPTIONS],
      ['memberPins', MEMBER_PIN_EXEMPTIONS],
    ];
    const reasons: string[] = [];
    for (const [name, ledger] of ledgers) {
      const owed = owedIdsOf(ledger);
      expect(
        owed.length,
        `${name}: the booked entries are not exactly the cap — strike an entry and ` +
          'lower the cap in the same change; the cap never rises',
      ).toBe(OBJECTUI_11111_LEDGER_CAPS[name]);
      for (const id of owed) {
        const reason = ledger[id];
        const owner = objectui11111OwnerOf(id);
        expect(
          reason.startsWith(`${OWED_PREFIX}${owner}.`),
          `${id} is not booked to ${owner}, the card the ruling routes it to`,
        ).toBe(true);
        expect(reason, `${id} does not cite the ruling`).toContain(
          'objectui#11111 decision 3 = B (record 5902351047)',
        );
        // The record that booked it: decision 3 = B itself for the 17.5.0
        // owners, objectui#11438 ruling A′ for objectui#11536, ruling A″ for
        // objectui#11068.
        expect(reason, `${id} does not cite the record that booked it`).toContain(
          `Booked by ${OBJECTUI_11111_BOOKINGS[owner].bookedBy}: `,
        );
        expect(reason, `${id} carries no expiry`).toContain(
          `Expires ${OBJECTUI_11111_BOOKINGS[owner].expires}, or when ${owner} lands`,
        );
        reasons.push(reason);
      }
    }
    // Per-owner totals, so an entry cannot move between owners without a diff here.
    expect(
      Object.fromEntries(
        OBJECTUI_11111_OWNERS.map((owner) => [
          owner,
          reasons.filter((reason) => reason.startsWith(`${OWED_PREFIX}${owner}.`)).length,
        ]),
      ),
    ).toEqual({
      'objectui#11168': 0,
      'objectui#8652': 0,
      'objectui#8649': 0,
      'objectui#11536': 0,
      'objectui#11068': 0,
      'objectui#13047': 0,
    });
  });
});
