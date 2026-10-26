/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:details` — the published authoring surface stays in parity with
 * `@objectstack/spec` `RecordDetailsProps` (objectui#3807, objectstack#5611).
 *
 * Sibling of `recordHighlightsInputs.spec-parity.test.ts` (objectui#3407 /
 * PR #3795) and the same two directions, on the block where the drift was
 * worse: there the `fields` description spelled an entry shape that was merely
 * INCOMPLETE (`readonly` missing); here the `sections` description spelled an
 * entry shape the spec had DELETED. Until 17.x `sections` was
 * `z.array(z.string())` — "section IDs" — and objectstack#5611 replaced that
 * with the object form outright (no producer, no consumer, so one shape rather
 * than two de-facto contracts). The registry text kept teaching the ID list.
 *
 * WHY A DESCRIPTION IS WORTH A TEST. `inputs` is not documentation, it is the
 * published contract: `gen-manifest.ts` serializes it into `sdui.manifest.json`
 * (the save-gate + parser whitelist) and into `sdui-intrinsics.d.ts` (the JSX
 * authoring surface), and for an array-of-objects input the ENTRY shape exists
 * nowhere else — `ComponentInput` has no member-shape slot, which is why the
 * repo-wide gate in `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`
 * (objectui#3797 / PR #3806) can only see top-level keys and says so in its
 * LIMIT note. An author following the retired spelling gets four silent layers:
 * `['a','b']` is a valid `array` to the manifest gate, upstream
 * `validateComponentProps` is advisory, the spec is only parsed on paths that
 * parse, and `RecordDetailsRenderer` reads `s.name` / `s.label` / `s.fields`
 * off each entry — all `undefined` on a string, so the section renders nothing.
 * Once `sections` is authored at all it is the ONLY source of the body, so the
 * page comes up blank with no diagnostic anywhere pointing at `sections`.
 * (That used to read "under `layout: 'custom'`". `layout` was removed in
 * @objectstack/spec 17.0.0 — its `auto` | `custom` semantics were never
 * implemented — and the body is now chosen by what you author: `sections`
 * renders the explicit groups, omitting it falls back to the object's
 * `highlightFields`. The blank-page failure this file guards is unchanged.)
 *
 * Every expectation below is DERIVED from the spec schema at runtime rather
 * than restating today's key list, so a spec change fails here instead of
 * quietly reopening the gap.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ComponentRegistry } from '@object-ui/core';
import {
  arrayElementSchema,
  authorableShapeKeys,
  isShapeKeyTombstoned,
  listedShapeKeys,
  resolvePropsShape,
} from '@object-ui/test-support';
import { PageComponentSchema, RecordDetailsProps } from '@objectstack/spec/ui';
import '../index';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The element schema of `RecordDetailsProps.<key>`, a `z.array(...)`.
 *
 * The wrapper walk and the element read are `@object-ui/test-support`'s
 * (objectui#5872 class (2)), not this file's. What stood here was one of three
 * disagreeing hand copies, and its last limb — `arr?._def?.type`, Zod 3's
 * spelling for a `ZodArray`'s element — is a landmine on the installed
 * `zod@4.4.3`, where `_def.type` is the type-name STRING `'array'`: had the
 * three limbs before it ever missed, this would have handed `listedShapeKeys`
 * a string and derived the empty set in silence. `arrayElementSchema` keeps
 * that Zod 3 spelling behind the `_def.typeName === 'ZodArray'` discriminator
 * so it can only answer where it is actually right.
 */
const specArrayElement = (key: string): unknown =>
  arrayElementSchema(resolvePropsShape(RecordDetailsProps)?.[key]);

/** Top-level keys of the spec's `RecordDetailsProps`, INCLUDING tombstones. */
const specTopLevelKeys = (): string[] => listedShapeKeys(RecordDetailsProps);

/**
 * Is this top-level key an ADR-0087 tombstone — declared, but rejected by name?
 *
 * This distinction is load-bearing, and objectui#3818 is what proved it. A D2
 * retirement does NOT delete the key from the shape; it REPLACES the member
 * with `z.never()` carrying the "removed in 17.0.0, run `os migrate meta`"
 * text. So a retired key still answers `Object.keys(shape)` — which is why
 * `layout` survived the 17.0.0-rc.6 pin bump on the published surface below
 * with every derived gate green: the gate asked "is this key in the shape",
 * the tombstone said yes, and the manifest kept offering an input the spec
 * rejects on parse. Filtering tombstones out is what makes the gate mean what
 * its name says.
 *
 * The criterion itself is NOT written out here (objectui#4947). It is
 * `@object-ui/test-support`'s shared judge, which OR-s the structural channel
 * this file used to carry alone with the `[REMOVED]` description channel, so
 * neither can go quietly permissive on its own.
 */
const isTombstoned = (key: string): boolean =>
  isShapeKeyTombstoned(RecordDetailsProps, key);

/** Top-level keys the spec actually ACCEPTS — tombstones removed. */
const specAcceptedTopLevelKeys = (): string[] => authorableShapeKeys(RecordDetailsProps);

/**
 * Keys the spec accepts on the NODE, on every page component — the widening
 * `recordRelatedListInputs.spec-parity.test.ts` and the repo-wide
 * `registry-inputs-spec-parity.test.ts` already make (objectui#6678).
 * `RecordDetailsProps` is this block's PROPS contract, not the whole contract of
 * the node: `dataSource`, the per-element binding this block reads since
 * objectui#12294 and declares from the seam, is a `PageComponentSchema` key.
 * DERIVED from that schema's own shape, never listed (a `.pipe()` through
 * `@objectstack/spec` 18.0.0-next.2, whose input side carried the keys; a plain
 * object since 18.0.0-next.3, objectstack `105902f`).
 */
const nodeLevelSpecKeys = (): string[] => authorableShapeKeys(PageComponentSchema);

/** Member keys of one `sections[]` entry, per the spec. */
const specSectionKeys = (): string[] =>
  listedShapeKeys(specArrayElement('sections'));

/**
 * Section keys the `sections` description may NOT teach. Read off
 * `renderers/record-details.tsx`: `s.showBorder` is honoured there beyond the
 * spec's four; `title` was honoured as a strict-priority ALIAS of the heading
 * slot (`s.title ?? s.label`) until objectui#6190 converged on the declared
 * `label` and dropped the limb.
 *
 * A hand-kept CANDIDATE set — keys this renderer honours on a section beyond
 * the spec's original four — and ⛔ not a statement about which of them the
 * spec refuses. The ASSERTION derives that per run by filtering this list
 * through the installed schema, so a candidate upstream declares drops out of
 * the forbidden set on its own instead of pinning a stale prohibition, and
 * one upstream retires re-arms without an edit here. ⛔ Do not read the
 * membership as a claim; read `stripped` in the assertion below.
 *
 * ⚠️ Which is why both names stay although they answer differently today:
 * `title` is refused by the installed spec, `showBorder` is declared by it.
 * ⛔ Both of those are PROSE — a reading, hedged to "today" and restated in
 * the body comment below — and neither is a VERDICT this file takes: nothing
 * here asserts either status, and every verdict the cases below reach is
 * derived from the installed schema per run. (The sentence that stood here
 * claimed neither fact was written down anywhere in this file, in the same
 * paragraph that writes both down — objectui#9637.)
 *
 * ⚠️ `hideEmpty` was a member and is GONE from the list under objectui#8603
 * (director seat batch #137 item 3, maintainer 2026-09-15), which restored the
 * renderer read after objectui#7129 retired it on the premise — falsified
 * upstream by the 17.3.0 pin move — that the spec refused the key. The spec
 * DECLARES it on the section entry, so it fails the membership criterion in
 * its own words: it is not a key the spec refuses. The runtime filter above
 * already dropped it from `stripped` before this edit, which is why removing
 * it changes no verdict here — the list is what states the criterion, and
 * leaving a declared key in it would state a prohibition the contract
 * contradicts. The `sections` description now teaches `hideEmpty`, and the
 * "every spec section member key is discoverable" case above is what requires
 * that.
 */
const RENDERER_ONLY_SECTION_KEYS = ['title', 'showBorder'];

/**
 * Does the installed spec REFUSE an undeclared key inside a `sections[]` entry,
 * or drop it in silence? (objectui#4648, measured on a GA-installed tree.)
 *
 * `@objectstack/spec` 17.0.0 GA closed the section object under
 * objectstack#4001 batch A; the pinned `17.0.0-rc.6` strips. The verdict this
 * file asserts is the same on both — those keys are not an authoring surface,
 * so the `sections` description may not teach them — but the evidence differs.
 *
 * Probed behaviourally, on the section object specifically: strictness is per
 * schema, so the top-level probe in the sibling `record:highlights` file says
 * nothing about this one.
 */
const specRefusesUnknownSectionKeys = !RecordDetailsProps.safeParse({
  sections: [{ label: 'Contact', fields: ['phone'], __objectui_4648_probe__: true }],
}).success;

/**
 * The TOP-LEVEL twin of the probe above — does the installed spec refuse an
 * undeclared key on the props object itself, or drop it in silence?
 * (objectui#5887.)
 *
 * Both probes exist for the same reason and neither substitutes for the other:
 * strictness is per SCHEMA, so the section-level reading above says nothing
 * about `RecordDetailsProps` itself, and the sibling
 * `recordHighlightsInputs.spec-parity.test.ts`'s top-level probe is a reading of
 * `RecordHighlightsProps` — the shape to copy, not evidence about this one.
 * Probed behaviourally rather than off a version string: the strictness IS the
 * fact, and a probe cannot go stale against a pin it never reads.
 *
 * The probe key is a name no spec would ever declare — and if one ever did, the
 * assertion below is what says so, rather than the probe quietly measuring a
 * declared key and reporting strip mode.
 */
const TOP_LEVEL_BASELINE = { fields: ['phone'] };
const UNDECLARED_TOP_LEVEL_KEY = '__objectui_5887_probe__';
const unknownTopLevelParse = RecordDetailsProps.safeParse({
  ...TOP_LEVEL_BASELINE,
  [UNDECLARED_TOP_LEVEL_KEY]: true,
});
const specRefusesUnknownTopLevelKeys = !unknownTopLevelParse.success;

const config = () => ComponentRegistry.getConfig('record:details');
const inputs = () => config()?.inputs ?? [];
const input = (name: string) => inputs().find((i) => i.name === name);
const sectionsDescription = () => input('sections')?.description ?? '';

describe('record:details — registry inputs vs @objectstack/spec', () => {
  it('is registered with a non-empty `inputs` surface', () => {
    expect(config()).toBeDefined();
    expect(inputs().map((i) => i.name)).toContain('sections');
  });

  it('the spec really takes OBJECT sections — the id-list spelling is gone, not unioned in', () => {
    // Guards the premise the rest of the file rests on. A `z.array(z.string())`
    // arm coming back (or the object form moving) must fail here first, because
    // the description below would then be documenting the wrong shape again.
    expect(specSectionKeys().length).toBeGreaterThan(0);

    // A VALUE verdict, so the criterion is a full parse, not key recognition:
    // the retired spelling has to be rejected on its value, and the object form
    // has to survive intact.
    //
    // NEITHER fixture may carry `layout` (objectui#4167). Both did until
    // @objectstack/spec 17.0.0-rc.6, which gave the key — removed in 17.0.0 under
    // ADR-0087 D2 (objectstack#6946) — a named `never` rejection. That rejection
    // is what the fixtures then hit: the object-form case failed on `layout`
    // while its `sections` were perfectly valid, and, worse, the id-list case
    // above kept PASSING on `layout`'s own `invalid_type` without ever reaching
    // `sections` — green for a reason that has nothing to do with what it
    // asserts. Dropping the key puts both verdicts back on `sections`, where the
    // issues now resolve to path `sections.0` / `sections.1`.
    const idList = RecordDetailsProps.safeParse({
      sections: ['contact_info', 'address'],
    });
    expect(idList.success).toBe(false);
    expect(idList.error?.issues.map((i) => i.code)).toContain('invalid_type');
    // Pin the PATH, not just the code — this is precisely the assertion that was
    // satisfied by the wrong key, and a code alone cannot tell the two apart.
    expect(idList.error?.issues.map((i) => i.path.join('.'))).toContain('sections.0');

    const objectForm = RecordDetailsProps.safeParse({
      sections: [{ name: 'contact_info', label: 'Contact', columns: 2, fields: ['phone'] }],
    });
    expect(objectForm.success).toBe(true);
    expect(objectForm.data?.sections?.[0]).toMatchObject({
      name: 'contact_info',
      columns: 2,
      fields: ['phone'],
    });
  });

  it('every spec section member key is discoverable from the `sections` description', () => {
    const description = sectionsDescription();
    expect(description).not.toBe('');
    const undocumented = specSectionKeys().filter((key) => !description.includes(key));
    expect(undocumented).toEqual([]);
  });

  it('the `sections` description no longer teaches the retired section-id spelling', () => {
    // The regression this issue was filed for, named explicitly so it stays
    // legible if the derived check above is ever loosened. The entry shape must
    // be stated as an object, and the string form must be ruled out in the same
    // breath — an author reading only "object form" would not know their
    // existing `['contact_info']` page is now silently empty.
    const description = sectionsDescription();
    expect(description).not.toMatch(/section ids/i);
    expect(description).toMatch(/object/i);
    expect(description).toMatch(/string/i);
  });

  it('publishes no section member key the spec refuses to carry', () => {
    // ⛔ Which of the candidates above the spec REFUSES is not stated here, and
    // that is the point: it is derived below, per run, from the installed
    // schema. `stripped` is that derivation, and only its members are the
    // subject of the assertions that follow.
    //
    // ⚠️ Read the derivation, ⛔ not a remembered list. Of the two candidates,
    // only `title` is refused by the installed spec today; `showBorder` IS
    // declared on the section entry and therefore leaves `stripped` on its
    // own. An earlier revision of this comment said the spec "does not declare
    // it" of `showBorder` — false since the entry grew to its current member
    // set, and false in a sentence no gate reads, which is commandment #9's
    // own failure mode. The list stays a hand-kept CANDIDATE set (keys this
    // renderer honours on a section beyond the spec's original four); the
    // filter is what decides membership of the forbidden set, so a candidate
    // the spec has since declared costs nothing and re-arms by itself if
    // upstream ever retires it.
    //
    // The fixture below carries `hideEmpty`, which the spec DOES declare since
    // 17.3.0 (the read restored here by objectui#8603): it is the live control
    // on that filter — a key that leaves `stripped` and must therefore NOT
    // appear among the refused names. Documenting a refused key here would
    // teach one the contract does not carry — the member-level twin of
    // publishing a top-level input the props schema rejects.
    const stripped = RENDERER_ONLY_SECTION_KEYS.filter(
      (key) => !specSectionKeys().includes(key),
    );
    expect(stripped).not.toEqual([]); // the premise: these really are undeclared

    const parsed = RecordDetailsProps.safeParse({
      sections: [{ label: 'Contact', fields: ['phone'], title: 'T', showBorder: true, hideEmpty: false }],
    });

    if (specRefusesUnknownSectionKeys) {
      // 17.0.0 GA closed the section object too (objectstack#4001 batch A), so
      // the three arrive as a named refusal instead of vanishing. Envelope, not
      // a bare failure: the code, and the keys it names — `label` / `fields`
      // must NOT be among them, which a plain `success === false` cannot tell.
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
      const refused = parsed.error?.issues.flatMap(
        (i) => (i as unknown as { keys?: string[] }).keys ?? [],
      );
      expect(refused).toEqual(expect.arrayContaining(stripped));
      expect(refused).not.toContain('label');
      expect(refused).not.toContain('fields');
      // …and the key objectui#8603 restored is on the DECLARED side of that
      // line: the same strict object that names `title` must not name it.
      expect(refused).not.toContain('hideEmpty');
    } else {
      // The pinned rc.6: dropped in silence, which is the harm this file was
      // filed over — success receipt, section renders without them.
      expect(parsed.success).toBe(true);
      expect(Object.keys(parsed.data?.sections?.[0] ?? {}).sort()).toEqual(['fields', 'label']);
    }

    // Word-boundary, not substring: this direction asks "does the text teach
    // this KEY", and prose legitimately contains words that merely embed one
    // ("untitled" embeds `title`). The forward check above can stay a substring
    // test because a false positive there only ever accepts a description that
    // does mention the key.
    const description = sectionsDescription();
    const published = stripped.filter((key) => new RegExp(`\\b${key}\\b`).test(description));
    expect(published).toEqual([]);
  });

  it('declares no top-level input the spec does not accept', () => {
    // ACCEPTED keys, not merely DECLARED ones — a tombstone is present in the
    // shape and rejects every value (see `isTombstoned`). Reading raw shape
    // keys here is what let the retired `layout` input stay published and green
    // through the 17.0.0-rc.6 bump (objectui#3818).
    const allowed = new Set([...specAcceptedTopLevelKeys(), ...nodeLevelSpecKeys()]);
    const offSpec = inputs().map((i) => i.name).filter((name) => !allowed.has(name));
    expect(offSpec).toEqual([]);
    // Calibration: the node-level widening is derived and discriminating.
    expect(nodeLevelSpecKeys()).toContain('dataSource');
    expect(nodeLevelSpecKeys()).not.toContain('sections');
  });

  it('publishes `hideFields`, which the renderer has read all along', () => {
    // The reverse direction on this block (objectui#3808). `hideFields` was
    // declared by the spec (objectstack#5611) and read by
    // `renderers/record-details.tsx:147` while `inputs` omitted it, so the
    // manifest, the generated `.d.ts` and the designer panel all said the key
    // did not exist and `sdui-parser` reported `unknown-prop` on an author who
    // wrote it anyway — while the renderer honoured it. Same shape as `readonly`
    // in objectui#3407.
    //
    // A KEY-reachability claim, so the criterion is that the key SURVIVES the
    // parse. The verdict behind that choice is the same on every pin — an
    // undeclared top-level key is not an authoring surface — while the contract
    // states it two ways depending on the installed `@objectstack/spec`: the
    // closed props schemas refuse it with a named `unrecognized_keys` (the
    // top-level twin of `specRefusesUnknownSectionKeys` above), where the older
    // strip-mode `z.object`s dropped it from `data` with no error at all, which
    // is exactly why the gap was silent. So "it is still there afterwards" is the
    // proof on both, and `success === true` is not — on a stripping pin an
    // undeclared key gets that too. Probed behaviourally rather than off a
    // version string, and measured on THIS schema:
    // `specRefusesUnknownTopLevelKeys` above, asserted in the block that follows
    // (objectui#5887). The sibling `recordHighlightsInputs.spec-parity.test.ts`
    // models the shape, and strictness is per schema, so it was only ever the
    // pattern rather than a reading of this one.
    expect(specTopLevelKeys()).toContain('hideFields');
    const parsed = RecordDetailsProps.safeParse({ hideFields: ['phone'] });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.hideFields).toEqual(['phone']);

    expect(inputs().map((i) => i.name)).toContain('hideFields');
    expect(input('hideFields')?.description ?? '').not.toBe('');
  });

  it('refuses an undeclared top-level key, measured on THIS schema (#5887)', () => {
    // The top-level counterpart of `publishes no section member key the spec
    // refuses to carry` above, and the reading the block before this one used to
    // borrow from a sibling. Both arms state the same verdict — an undeclared
    // top-level key is not an authoring surface — because the contract states it
    // two ways depending on the installed `@objectstack/spec`, and pinning the
    // wrong one reds this file for a reason unrelated to what it guards.
    //
    // CONTROL FIRST, in this same assertion: the identical fixture WITHOUT the
    // probe key parses green, so the probe's verdict below is attributable to the
    // undeclared key and not to a malformed fixture. Without it, a probe that
    // failed for any other reason would read as strictness.
    expect(RecordDetailsProps.safeParse(TOP_LEVEL_BASELINE).success).toBe(true);

    if (specRefusesUnknownTopLevelKeys) {
      // A loud refusal. Asserted as an ENVELOPE — the code AND the key it names —
      // because a bare "it failed" would also be satisfied by a rejection of
      // `fields`, which is the half that must stay valid.
      expect(unknownTopLevelParse.success).toBe(false);
      expect(unknownTopLevelParse.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
      expect(
        unknownTopLevelParse.error?.issues.flatMap(
          (i) => (i as unknown as { keys?: string[] }).keys ?? [],
        ),
      ).toContain(UNDECLARED_TOP_LEVEL_KEY);
    } else {
      // Strip mode, and the concrete harm this family keeps re-paying for: no
      // throw, no diagnostic, key gone, author handed a success receipt.
      expect(unknownTopLevelParse.success).toBe(true);
      expect(unknownTopLevelParse.data).not.toHaveProperty(UNDECLARED_TOP_LEVEL_KEY);
    }
  });

  it('`hideFields` documents bare names only, because the spec rejects entry objects', () => {
    // The same fence `fields` is held to below, on the sibling key — and here it
    // is a VALUE verdict, so the criterion is a full parse either way: the object
    // spelling has to be rejected on its value, not merely stripped.
    //
    // The renderer is more tolerant than the contract at this read site
    // (`typeof n === 'string' ? n : fieldName(n)`), which is not a second
    // contract to advertise. Every in-repo producer passes strings
    // (`synth/buildDefaultPageSchema.ts:557-562` types it `string[]`), so the
    // tolerant arm is unexercised drift rather than a live dialect.
    const element = specArrayElement('hideFields');
    expect(listedShapeKeys(element)).toEqual([]);
    expect(RecordDetailsProps.safeParse({ hideFields: ['phone'] }).success).toBe(true);

    const objectForm = RecordDetailsProps.safeParse({ hideFields: [{ name: 'phone' }] });
    expect(objectForm.success).toBe(false);
    expect(objectForm.error?.issues.map((i) => i.code)).toContain('invalid_type');

    // Non-empty FIRST. A `not.toContain('{')` on a description that does not
    // exist passes for the wrong reason — the reverse-verification run for
    // objectui#3808 deleted the `hideFields` declaration and watched this
    // assertion stay green on `''` while the three assertions that matter went
    // red. An empty description is a failure here, not a vacuous pass.
    const description = input('hideFields')?.description ?? '';
    expect(description).not.toBe('');
    expect(description).not.toContain('{');
  });

  it('publishes the two GA keys the renderer has read all along (#4668)', () => {
    // The same reverse direction as `hideFields` above, on the two keys
    // @objectstack/spec 17.0.0 GA added to this block. Both were read by
    // `RecordDetailsRenderer` — `(schema.inlineEdit ?? true) &&
    // objectInlineEditable`, and `showHeader: schema.showHeader ?? false` on the
    // synthesized `detail-view` — while `inputs` omitted them, so the manifest
    // and the generated `.d.ts` said the keys did not exist and `sdui-parser`
    // reported `unknown-prop` on an author who wrote one, which the renderer then
    // honoured.
    //
    // A VALUE verdict, not merely a key-reachability one: the published
    // `type: 'boolean'` is a claim about which values the contract takes, so the
    // criterion is a full parse both ways. Both keys read straight off the
    // top-level schema, so unlike `page:tabs.alwaysShowStrip` (see
    // `packages/components/src/__tests__/page-tabs-always-show-strip.test.tsx`)
    // the published spelling was already the one the renderer reads — no arm had
    // to be added here.
    for (const key of ['inlineEdit', 'showHeader']) {
      expect(specTopLevelKeys()).toContain(key);
      expect(isTombstoned(key), `${key} is a tombstone, not a live key`).toBe(false);

      expect(inputs().map((i) => i.name)).toContain(key);
      expect(input(key)?.type).toBe('boolean');
      expect((input(key)?.description ?? '').length).toBeGreaterThan(0);

      for (const value of [true, false]) {
        const parsed = RecordDetailsProps.safeParse({ [key]: value });
        expect(parsed.success).toBe(true);
        expect((parsed.data as Record<string, unknown> | undefined)?.[key]).toBe(value);
      }
      for (const rejected of [1, 'true', null]) {
        const parsed = RecordDetailsProps.safeParse({ [key]: rejected });
        expect(parsed.success, `spec accepted ${key}=${JSON.stringify(rejected)}`).toBe(false);
        expect(parsed.error?.issues.map((i) => i.path.join('.'))).toContain(key);
      }
    }
  });

  it('`inlineEdit` is documented as the opt-OUT it actually is (#4668)', () => {
    // The description is the only place this asymmetry can be stated, and it is
    // the part a wrong reading makes expensive rather than merely vague: the
    // value is AND-ed with the object's resolved editability (ADR-0103) and with
    // the server's effective API operation set (objectui#3546), so `false` is
    // unconditional while `true` cannot open editing the platform refuses. An
    // author told "true enables inline editing" files a bug against the renderer
    // when a system object stays read-only.
    const description = input('inlineEdit')?.description ?? '';
    expect(description).not.toBe('');
    expect(description).toMatch(/false/);
    // Asserted against the renderer's OWN read, so the text cannot drift from
    // it: `record-details.tsx` falls back with `schema.inlineEdit ?? true` and
    // `schema.showHeader ?? false`. (The registration used to restate both as
    // `ComponentInput.defaultValue`; that key is an ADR-0049 tombstone since
    // objectui#7493 — nothing ever read it — so the read site is the pin.)
    const renderer = readFileSync(resolve(__dirname, '../renderers/record-details.tsx'), 'utf8');
    expect(renderer).toMatch(/schema\.inlineEdit \?\? true/);
    expect(renderer).toMatch(/schema\.showHeader \?\? false/);
  });

  it('`fields` documents no entry shape, because the spec accepts bare names only', () => {
    // objectui#3807's fence check on the sibling input at the same call site.
    // Top-level `fields` is `z.array(z.string())`: there is no member shape to
    // publish, and the renderer's tolerance for `{name}` / `{field}` entries is
    // not a second contract to advertise — the spec rejects those values.
    const element = specArrayElement('fields');
    expect(listedShapeKeys(element)).toEqual([]);
    expect(RecordDetailsProps.safeParse({ fields: ['phone'] }).success).toBe(true);
    expect(RecordDetailsProps.safeParse({ fields: [{ name: 'phone' }] }).success).toBe(false);

    const description = input('fields')?.description ?? '';
    expect(description).not.toBe('');
    expect(description).not.toContain('{');
  });
});

/**
 * objectui#3818 — the retired `layout` key, pinned on the published surface.
 *
 * `record:details` published `layout: enum ['auto','custom']` with
 * `defaultValue: 'auto'` and the description "auto uses the object
 * highlightFields; custom uses explicit sections". None of that was ever
 * implemented: the renderer's ONLY `schema.layout` read tested `'inline'` |
 * `'compact'` — two values the schema never permitted — so both legal values
 * fell through the same ternary to `'vertical'` and the key selected nothing.
 * A two-value enum whose values do the same thing is a false affordance with
 * zero diagnostics: an author writing `layout: 'custom'` believed it took
 * effect. @objectstack/spec 17.0.0 removed the key (objectstack#6946,
 * ADR-0087 D2) and the maintainer ruling of 2026-08-09 on objectui#3818 is
 * REMOVAL on this side too.
 *
 * Why these pins are not redundant with the derived gate above: a D2 tombstone
 * stays IN the shape (see `isTombstoned`), so every key-presence check kept
 * passing while the input was still published. The gate is now
 * tombstone-aware, and the assertions below name this key so the repair stays
 * legible if that helper is ever loosened.
 */
describe('record:details — `layout` is retired, not merely undocumented (#3818)', () => {
  it('the spec REJECTS `layout`, with the ADR-0087 migration message', () => {
    // The premise, checked first: if upstream ever un-retires the key, this
    // fails before the negative pins below start guarding a dead rule.
    expect(specTopLevelKeys()).toContain('layout'); // tombstone is still declared
    expect(isTombstoned('layout')).toBe(true);
    expect(specAcceptedTopLevelKeys()).not.toContain('layout');

    // A rejection case, so the assertion set is the envelope and not a bare
    // "it failed": path + code + the named migration text. Both formerly
    // published values AND both values the dead renderer branch tested — all
    // four are unauthorable now, which is the whole point.
    for (const value of ['auto', 'custom', 'inline', 'compact']) {
      const parsed = RecordDetailsProps.safeParse({ layout: value });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((i) => i.path.join('.'))).toContain('layout');
      expect(parsed.error?.issues.map((i) => i.code)).toContain('invalid_type');
      expect(parsed.error?.issues[0]?.message).toMatch(/removed in @objectstack\/spec 17\.0\.0/);
    }
  });

  it('the published surface offers no `layout` input', () => {
    // Non-empty FIRST — `inputs()` returning `[]` would satisfy every
    // absence assertion below for the wrong reason (the vacuous-green trap
    // the `hideFields` block above documents from objectui#3808's reverse run).
    expect(inputs().length).toBeGreaterThan(0);
    expect(inputs().map((i) => i.name)).toContain('sections');

    expect(inputs().map((i) => i.name)).not.toContain('layout');
    expect(input('layout')).toBeUndefined();
  });

  it('no input description still teaches `layout` as an authorable key', () => {
    // The declaration and its prose died together: `sections` used to end
    // "Required when layout is 'custom'", which would have kept teaching the
    // key from a neighbouring description after the input itself was gone.
    const descriptions = inputs().map((i) => i.description ?? '');
    expect(descriptions.join('')).not.toBe('');
    for (const description of descriptions) {
      expect(description).not.toMatch(/\blayout is\b/i);
      expect(description).not.toMatch(/layout:\s*['"]?(auto|custom)/i);
    }
  });

  it('the renderer contains no `schema.layout` read', () => {
    // Source-text half. The behavioural twin lives in
    // `recordDetailsBodySource.test.tsx` (authoring the key changes no output);
    // this one catches a re-added branch that a render assertion could miss if
    // the branch were re-introduced behind a condition the fixtures never hit.
    const src = readFileSync(join(SRC_DIR, 'renderers/record-details.tsx'), 'utf8');
    expect(src).toContain('RecordDetailsRenderer'); // the file really is the renderer
    expect(src).not.toMatch(/schema\s*\.\s*layout/);
    expect(src).not.toMatch(/['"]compact['"]/);
  });
});

/**
 * objectui#8649 — the field-security triple, published as the CONTRACT declares
 * it on this block.
 *
 * `@objectstack/spec` 17.5.0 declares `enforceFieldSecurity`, `redactFields` and
 * `requiredPermissions` on `record:details`. The renderer honoured all three before that,
 * through a cast, while these `inputs` omitted them; objectui#8649 publishes
 * them. Three claims per key, each read off the INSTALLED spec rather than
 * restated: the key is declared on this block's props, the published coarse
 * type is the one the contract's VALUES bear out (a full parse on an accepted
 * value and a named refusal on a rejected one — a value claim, so a key-level
 * `unrecognized_keys` reading would not do), and the description is this
 * block's own `.describe()` text, verbatim — so a spec that rewords one turns
 * this file red rather than leaving the manifest to drift.
 */
describe('record:details — the field-security triple is published as the contract declares it (objectui#8649)', () => {
  const TRIPLE = {
    enforceFieldSecurity: { type: 'boolean', of: undefined, accepted: true, refused: 'true' },
    redactFields: { type: 'array', of: 'string', accepted: ['salary'], refused: [1] },
    requiredPermissions: { type: 'array', of: 'string', accepted: ['crm.manage'], refused: 'crm.manage' },
  } as const;
  const shapeOf = (key: string) =>
    (RecordDetailsProps.shape as Record<string, { description?: string; def?: { innerType?: { description?: string } } }>)[key];
  const describeOf = (key: string): string | undefined =>
    shapeOf(key)?.description ?? shapeOf(key)?.def?.innerType?.description;

  for (const [key, want] of Object.entries(TRIPLE)) {
    it(`publishes \`${key}\` with the contract's type, proved on values`, () => {
      expect(Object.keys(RecordDetailsProps.shape), `${key} is not declared on record:details`).toContain(key);
      const published = input(key);
      expect(published, `${key} is not published`).toBeDefined();
      expect(published?.type).toBe(want.type);
      expect(published?.of).toBe(want.of);

      const ok = RecordDetailsProps.safeParse({ ...TOP_LEVEL_BASELINE, [key]: want.accepted });
      expect(ok.success, `${key}: the contract refused a value of the published type`).toBe(true);
      expect((ok.data as Record<string, unknown> | undefined)?.[key]).toEqual(want.accepted);
      const bad = RecordDetailsProps.safeParse({ ...TOP_LEVEL_BASELINE, [key]: want.refused });
      expect(bad.success, `${key}: the contract accepted a value outside the published type`).toBe(false);
      // Refused AT this key — `redactFields: [1]` is refused at its MEMBER
      // (`redactFields.0`), which is the member-kind half of the same claim.
      expect(bad.error?.issues.map((i) => String(i.path[0]))).toContain(key);
    });

    it(`\`${key}\`'s description is this block's own describe text, verbatim`, () => {
      const text = describeOf(key);
      // Non-vacuity: an undefined describe would compare equal to a missing one.
      expect(text ?? '', `${key}: the contract carries no describe to publish`).not.toBe('');
      expect(input(key)?.description).toBe(text);
    });
  }

  it('CONTROL — the value probe refuses at the key it names, and accepts the unmodified baseline', () => {
    expect(RecordDetailsProps.safeParse(TOP_LEVEL_BASELINE).success).toBe(true);
    const bad = RecordDetailsProps.safeParse({ ...TOP_LEVEL_BASELINE, enforceFieldSecurity: 'true' });
    expect(bad.error?.issues.map((i) => i.path.join('.'))).toEqual(['enforceFieldSecurity']);
  });
});
