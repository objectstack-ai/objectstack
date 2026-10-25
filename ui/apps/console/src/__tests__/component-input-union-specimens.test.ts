/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The five measured specimens of objectui#3832: a `ComponentInput` whose spec
 * type is a UNION, declared with one arm, so the repo's own manifest gate
 * reported `type-mismatch` on the OTHER arm — a legal write.
 *
 * Four of them are the inline-translation-map shapes, and they are the loud
 * ones: the input's own `description` teaches the author to write
 * `{ en, "zh-CN" }` while the same input's `type: 'string'` made
 * `sdui-parser`'s `checkType` warn about it. One platform authority, two halves,
 * contradicting each other on the write it had just recommended. The fifth is
 * `element:text_input.defaultValue`, whose spec type is `string | number`
 * (measured against `ElementTextInputPropsSchema` in
 * `packages/components/src/__tests__/text-input-inputs-spec-parity.test.ts`).
 *
 * The maintainer ruling (2026-08-09) picked direction (a): `ComponentInput.type`
 * learns to express unions, `checkType` passes when ANY arm matches, and these
 * five declare their real unions. This file is the user-visible acceptance face
 * of that ruling — it drives the SAME `manifestFromConfigs` + `validateTree`
 * pair the JSX-page compiler (`packages/components/src/renderers/layout/page.tsx:462`)
 * and the save gate use, over the registry the console really registers.
 *
 * ## Why every specimen comes with a control
 *
 * "No diagnostic" is also what a SILENCED check looks like, and this change is
 * a widening: if `checkType` stopped reporting `type-mismatch` at all, or if the
 * array-valued `type` fell through the switch into `default: return null` (which
 * is exactly what the pre-#3832 `switch (input.type)` does when handed an
 * array), every positive assertion here would still pass. So each specimen is
 * paired with a value that matches NEITHER arm and must still be reported. That
 * pairing is what the mutation runs in the PR body key off: reverting the
 * any-arm logic alone leaves the positives GREEN (vacuously — the switch
 * swallows the array) and turns the CONTROLS red.
 *
 * Module-scope imports, not `beforeAll` (AGENTS.md §测试纪律): the specimens
 * resolve through registration side-effects, and paying that at import time
 * keeps it out of every test/hook timeout budget.
 *
 * ## Specimens 6 and 7 — objectui#4970
 *
 * `element:text.content` and `element:button.label` are the same shape and were
 * measured during #3832's implementation, after the ruling had already fixed its
 * scope at "the five measured specimens" — so they were filed separately rather
 * than folded in, and land here in their own `describe` below. Their arms are
 * derived from the spec's own verdicts rather than restated, which is the
 * discipline `text-input-inputs-spec-parity.test.ts` adopted for the fifth
 * specimen: the gap #3832 closed is EXPRESSIVENESS, and per-key derivation is
 * how a specimen states the contract half for itself.
 *
 * That half is no longer only per-key. objectui#4971 landed the repo-wide arm
 * direction in `registry-inputs-spec-parity.test.ts`: every declared arm must be
 * a kind the spec accepts on that key. It does NOT subsume this file — it judges
 * DECLARATIONS against the contract, while this one drives `manifestFromConfigs`
 * + `validateTree` and judges the GATE against the declarations. A regression in
 * either is invisible to the other.
 */
import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { Diagnostic, SchemaElement } from '@object-ui/sdui-parser';
import {
  ElementButtonPropsSchema,
  ElementTextInputPropsSchema,
  ElementTextPropsSchema,
} from '@objectstack/spec/ui';
import '@object-ui/components';
import '../register-plugins';

/**
 * The manifest built from the WHOLE registry, not just the public tier.
 * `element:text_input` is `tier:'internal'` and so never reaches
 * `sdui.manifest.json`, but `page.tsx:462` builds the JSX-page compiler's prop
 * whitelist from `getKnownTypes()` + these same `inputs` — which is where its
 * `defaultValue` diagnostic was reaching authors.
 */
const manifest = manifestFromConfigs(
  ComponentRegistry.getAllConfigs() as unknown as Parameters<typeof manifestFromConfigs>[0],
);

const diagnose = (node: unknown): Diagnostic[] =>
  validateTree(node as SchemaElement, manifest).diagnostics;

const codesFor = (node: unknown): string[] => diagnose(node).map((d) => d.code);

/** The inline translation map an author is told to write, verbatim from the descriptions. */
const I18N_MAP = { en: 'Account', 'zh-CN': '客户' };

const declaredArms = (type: string, input: string): string[] => {
  const declared = manifest.components[type]?.inputs.find((i) => i.name === input)?.type;
  return Array.isArray(declared) ? declared : [declared as string];
};

/**
 * One representative value per coarse arm, in the vocabulary `checkType`'s
 * `armAccepts` uses (`packages/sdui-parser/src/validate.ts`).
 *
 * `['Account']` earns its place: the `'object'` arm accepts a non-null non-array
 * object and nothing else, so an array is the value that tells "declares the
 * object arm" apart from "stopped checking non-primitives".
 */
const COARSE_ARM_PROBES: ReadonlyArray<readonly [string, unknown]> = [
  ['string', 'Account'],
  ['object', I18N_MAP],
  ['number', 42],
  ['boolean', true],
  ['array', ['Account']],
];

type SpecPropsSchema = { safeParse: (value: unknown) => { success: boolean } };

/**
 * The coarse arms a spec props schema ACCEPTS for one key — derived from the
 * schema's own verdicts, not read off its Zod internals and not restated here
 * (objectui#4970).
 *
 * Restating them would pin the declaration and leave the fact the declaration
 * exists FOR — that the arms are the ones the contract accepts — unmeasured,
 * which is the disposition `text-input-inputs-spec-parity.test.ts` took for the
 * fifth specimen. Derived, either side moving turns the comparison red: a spec
 * release that drops an arm, or a declaration that grows one the spec rejects.
 */
const specAcceptedArms = (schema: SpecPropsSchema, key: string): string[] =>
  COARSE_ARM_PROBES.filter(([, value]) => schema.safeParse({ [key]: value }).success).map(
    ([arm]) => arm,
  );

describe('objectui#3832 — the five measured specimens declare their real unions', () => {
  it('every specimen block is registered (reachability before absence)', () => {
    // Without this, a renamed or unregistered block would satisfy every
    // "no type-mismatch" assertion below by never being validated at all —
    // `unknown-component` is a different code, and the filters here are
    // per-code by design.
    for (const type of ['page:header', 'page:card', 'record:alert', 'element:text_input']) {
      expect(manifest.components[type], `${type} is not registered`).toBeDefined();
    }
  });

  it('`page:header.title` / `.subtitle` accept the inline translation map', () => {
    // The spec union, measured: `ComponentPropsMap['page:header'].title` is
    // `string | Record< string, string >` and `.subtitle` the same.
    expect(declaredArms('page:header', 'title')).toEqual(
      expect.arrayContaining(['string', 'object']),
    );

    const mapped = { type: 'page:header', title: I18N_MAP, subtitle: I18N_MAP };
    expect(diagnose(mapped).filter((d) => d.code === 'type-mismatch')).toEqual([]);

    // …and the plain-string arm keeps validating clean (that half must not move).
    expect(
      diagnose({ type: 'page:header', title: 'Account', subtitle: 'All accounts' }).filter(
        (d) => d.code === 'type-mismatch',
      ),
    ).toEqual([]);

    // CONTROL — a value matching NEITHER arm is still reported.
    expect(codesFor({ type: 'page:header', title: true })).toContain('type-mismatch');
    expect(codesFor({ type: 'page:header', title: 'ok', subtitle: 42 })).toContain(
      'type-mismatch',
    );
  });

  it('`page:card.title` accepts the inline translation map', () => {
    expect(declaredArms('page:card', 'title')).toEqual(
      expect.arrayContaining(['string', 'object']),
    );
    expect(
      diagnose({ type: 'page:card', title: I18N_MAP }).filter((d) => d.code === 'type-mismatch'),
    ).toEqual([]);
    expect(
      diagnose({ type: 'page:card', title: 'Account' }).filter((d) => d.code === 'type-mismatch'),
    ).toEqual([]);

    // CONTROL
    expect(codesFor({ type: 'page:card', title: ['Account'] })).toContain('type-mismatch');
  });

  it('`record:alert.title` / `.body` accept the inline translation map', () => {
    // These two have no spec props schema at rc.6 (`ComponentPropsMap` carries
    // no `record:alert` entry — measured), so the union comes from the RENDERER:
    // `record-alert.tsx:126-127` resolves both through `pickLocalized`, which is
    // what the descriptions already teach.
    expect(declaredArms('record:alert', 'title')).toEqual(
      expect.arrayContaining(['string', 'object']),
    );
    const mapped = { type: 'record:alert', title: I18N_MAP, body: I18N_MAP };
    expect(diagnose(mapped).filter((d) => d.code === 'type-mismatch')).toEqual([]);
    expect(
      diagnose({ type: 'record:alert', title: 'Overdue', body: 'Pay it' }).filter(
        (d) => d.code === 'type-mismatch',
      ),
    ).toEqual([]);

    // CONTROL
    expect(codesFor({ type: 'record:alert', title: 7 })).toContain('type-mismatch');
  });

  it('`element:text_input.defaultValue` accepts the number arm', () => {
    expect(declaredArms('element:text_input', 'defaultValue')).toEqual(
      expect.arrayContaining(['string', 'number']),
    );
    expect(
      diagnose({ type: 'element:text_input', defaultValue: 42, inputType: 'number' }).filter(
        (d) => d.code === 'type-mismatch',
      ),
    ).toEqual([]);
    expect(
      diagnose({ type: 'element:text_input', defaultValue: 'acme' }).filter(
        (d) => d.code === 'type-mismatch',
      ),
    ).toEqual([]);

    // CONTROL — the spec rejects a boolean here (measured in the block's own
    // spec-parity test), and so must the gate. The i18n map is a control too:
    // `ElementTextInputPropsSchema` refuses it, so this key must NOT have
    // acquired the `object` arm its neighbours got.
    expect(codesFor({ type: 'element:text_input', defaultValue: true })).toContain(
      'type-mismatch',
    );
    expect(codesFor({ type: 'element:text_input', defaultValue: I18N_MAP })).toContain(
      'type-mismatch',
    );
  });

  it('`element:record_picker.emptyText` accepts the inline translation map once its render site resolves one', () => {
    // THE PIN THAT MOVED, and the condition it was written to wait for.
    //
    // This case used to assert the opposite — `toEqual(['string'])` plus a
    // `type-mismatch` on the map — and it was correct for as long as its own
    // reason held: rc.6 widened the contract to the `I18nLabel` union while the
    // renderer still passed the value into a text node with no locale
    // resolution, so declaring the object arm would have advertised a shape the
    // renderer dropped. Its comment named the release condition in those words
    // — "keeps its single `'string'` arm UNTIL THE RENDER SITE CATCHES UP".
    //
    // objectui#5590 is the render site catching up:
    // `record-picker.tsx` now reads `pickLocalized(props.emptyText ?? 'No
    // records', language)`, so the map arm reaches the screen resolved and
    // withholding it here would be the false declaration in the other
    // direction — the gate reporting `type-mismatch` on a legal write this very
    // input's `description` teaches the author to make.
    //
    // What this file guards is UNCHANGED by the flip: the widening is still
    // per-key, not a blanket "strings may also be objects". That property is
    // asserted by `element:text_input.defaultValue` above, whose I18N_MAP
    // control must still report `type-mismatch` because its spec type is
    // `string | number` — a key whose contract has no object arm.
    expect(declaredArms('element:record_picker', 'emptyText')).toEqual(
      expect.arrayContaining(['string', 'object']),
    );
    expect(
      diagnose({ type: 'element:record_picker', emptyText: I18N_MAP }).filter(
        (d) => d.code === 'type-mismatch',
      ),
    ).toEqual([]);
    expect(
      diagnose({ type: 'element:record_picker', emptyText: 'No records' }).filter(
        (d) => d.code === 'type-mismatch',
      ),
    ).toEqual([]);

    // CONTROL — a value matching NEITHER declared arm is still reported, so the
    // two green assertions above cannot be satisfied by a silenced check.
    expect(codesFor({ type: 'element:record_picker', emptyText: 42 })).toContain(
      'type-mismatch',
    );
    expect(codesFor({ type: 'element:record_picker', emptyText: ['No records'] })).toContain(
      'type-mismatch',
    );
  });
});

/**
 * objectui#4970 — specimens 6 and 7, the two the #3832 table missed.
 *
 * Same contradiction, same evidence: both keys are `required: true`, both blocks
 * are in `PUBLIC_BLOCKS` (`packages/core/src/registry/public-blocks.ts:89` /
 * `:91`) so they reach `sdui.manifest.json` and `sdui-intrinsics.d.ts`, both
 * descriptions tell the author to write an inline translation map, and both
 * renderers resolve one (`elements.tsx`, `pickLocalized` at the `content` and
 * `label` read sites). Only the declared arm disagreed.
 *
 * Controls are paired per specimen for the reason the #3832 block states above,
 * and they are not decoration: reverting `checkType`'s any-arm logic leaves the
 * positives vacuously green — the array-valued `type` falls into the old
 * `switch`'s `default: return null` and the prop produces nothing at all — so the
 * controls are the only half that moves.
 */
describe('objectui#4970 — element:text.content / element:button.label declare their real unions', () => {
  it('both specimen blocks are registered (reachability before absence)', () => {
    // Without this, an unregistered or renamed block satisfies every
    // "no type-mismatch" assertion below by never being validated at all —
    // an absent block reports `unknown-component`, a different code, and the
    // filters here are per-code by design.
    for (const type of ['element:text', 'element:button']) {
      expect(manifest.components[type], `${type} is not registered`).toBeDefined();
    }
  });

  it('the installed spec accepts the string and inline-map arms on both keys, and no others', () => {
    // Guards the derivation before anything is compared against it: a schema
    // that rejected every probe (a renamed key, a new sibling required key)
    // would return `[]` and make the two comparisons below agree vacuously.
    //
    // Measured on the `@objectstack/spec` 17.0.0 GA pin, which is what makes
    // these arms honest rather than copied from the issue — #4970's own table
    // was measured at the 17.0.0-rc.6 pin, and the answer had to be re-taken
    // before the declarations moved.
    expect(specAcceptedArms(ElementTextPropsSchema, 'content')).toEqual(['string', 'object']);
    expect(specAcceptedArms(ElementButtonPropsSchema, 'label')).toEqual(['string', 'object']);
  });

  it('`element:text.content` accepts the inline translation map', () => {
    expect([...declaredArms('element:text', 'content')].sort()).toEqual(
      [...specAcceptedArms(ElementTextPropsSchema, 'content')].sort(),
    );

    expect(
      diagnose({ type: 'element:text', content: I18N_MAP }).filter(
        (d) => d.code === 'type-mismatch',
      ),
    ).toEqual([]);

    // …and the plain-string arm keeps validating clean (that half must not move).
    expect(
      diagnose({ type: 'element:text', content: 'Account' }).filter(
        (d) => d.code === 'type-mismatch',
      ),
    ).toEqual([]);

    // CONTROL — values matching NEITHER arm are still reported. The spec refuses
    // both (measured above), so the gate must too.
    expect(codesFor({ type: 'element:text', content: 42 })).toContain('type-mismatch');
    expect(codesFor({ type: 'element:text', content: ['Account'] })).toContain('type-mismatch');
  });

  it('`element:button.label` accepts the inline translation map', () => {
    expect([...declaredArms('element:button', 'label')].sort()).toEqual(
      [...specAcceptedArms(ElementButtonPropsSchema, 'label')].sort(),
    );

    expect(
      diagnose({ type: 'element:button', label: I18N_MAP }).filter(
        (d) => d.code === 'type-mismatch',
      ),
    ).toEqual([]);
    expect(
      diagnose({ type: 'element:button', label: 'Save' }).filter((d) => d.code === 'type-mismatch'),
    ).toEqual([]);

    // CONTROL
    expect(codesFor({ type: 'element:button', label: true })).toContain('type-mismatch');
    expect(codesFor({ type: 'element:button', label: ['Save'] })).toContain('type-mismatch');
  });
});

/**
 * objectui#5717 — `element:text_input`'s `label` / `placeholder` / `description`,
 * the trio whose declaration lagged a render site that was never behind.
 *
 * Every specimen above earned its object arm in the change that taught its
 * RENDER SITE to resolve the map: `element:record_picker.emptyText`
 * (objectui#5590) and that block's `label` / `placeholder` (objectui#5637) each
 * held `['string']` for exactly as long as their renderer dropped the map. This
 * block is the INVERSE and the reason it needed its own card:
 * `text-input.tsx` has resolved all three keys through `pickLocalized` since it
 * was written, so the map always reached the screen correctly in the viewer's
 * language — and the declaration still said `'string'`, so `validateTree`
 * reported `type-mismatch` on a legal write. Measured on `d8afbe519` before the
 * fix, through this file's own `manifestFromConfigs` + `validateTree` pair:
 *
 *     label        declaredArms="string"  ["type-mismatch :: <element:text_input> prop \"label\" expected a string"]
 *     placeholder  declaredArms="string"  ["type-mismatch :: <element:text_input> prop \"placeholder\" expected a string"]
 *     description  declaredArms="string"  ["type-mismatch :: <element:text_input> prop \"description\" expected a string"]
 *
 * ## Why this file, and not only the block's spec-parity test
 *
 * `packages/components/src/__tests__/text-input-inputs-spec-parity.test.ts`
 * asserts declared-arms == spec-accepted-arms per key, which is the DECLARATION
 * half. It cannot see the defect: the defect is a DIAGNOSTIC emitted by
 * `validateTree` over a manifest, and a type-level or declaration-level
 * assertion never runs that path. This file drives the same pair the JSX-page
 * compiler (`packages/components/src/renderers/layout/page.tsx:462`) and the
 * save gate use, which is where the warning was actually reaching authors — so
 * without a pin here the fix could regress with every parity assertion still
 * green.
 *
 * ## Controls, and the one that is not local to this block
 *
 * Each specimen carries a value matching NEITHER arm, for the reason the #3832
 * block states: "no diagnostic" is also what a silenced check looks like. This
 * block has a second control that lives one `it` away rather than inside it —
 * `element:text_input.defaultValue` above, whose spec type is `string | number`
 * and whose `I18N_MAP` case must STILL report `type-mismatch`. That is the
 * assertion which makes this widening per-key rather than blanket, and it is on
 * the same component: had the object arm been applied to the block instead of
 * to the three keys whose contract admits it, that case is what goes green.
 */
describe('objectui#5717 — element:text_input label / placeholder / description declare their real unions', () => {
  it('the specimen block is registered (reachability before absence)', () => {
    // Without this, an unregistered or renamed block satisfies every
    // "no type-mismatch" assertion below by never being validated at all —
    // an absent block reports `unknown-component`, a different code, and the
    // filters here are per-code by design.
    expect(manifest.components['element:text_input'], 'element:text_input is not registered').toBeDefined();
  });

  it('the installed spec accepts the string and inline-map arms on all three keys, and no others', () => {
    // Guards the derivation before anything is compared against it: a schema
    // that rejected every probe (a renamed key, a new sibling required key)
    // would return `[]` and make the three comparisons below agree vacuously.
    //
    // Measured on the `@objectstack/spec` 17.1.0 pin — the same discipline the
    // #4970 block adopted, and the reason these arms are honest rather than
    // copied from the card that reported them.
    expect(specAcceptedArms(ElementTextInputPropsSchema, 'label')).toEqual(['string', 'object']);
    expect(specAcceptedArms(ElementTextInputPropsSchema, 'placeholder')).toEqual([
      'string',
      'object',
    ]);
    expect(specAcceptedArms(ElementTextInputPropsSchema, 'description')).toEqual([
      'string',
      'object',
    ]);
  });

  it('the sibling key whose contract has NO object arm is measured the same way', () => {
    // The separation asserted from the CONTRACT rather than from the
    // declaration, so "why is defaultValue different" is answered by evidence
    // in the same vocabulary. Without this line the per-key control below reads
    // as a convention; with it, it reads as the contract.
    expect(specAcceptedArms(ElementTextInputPropsSchema, 'defaultValue')).toEqual([
      'string',
      'number',
    ]);
  });

  it('`element:text_input.label` accepts the inline translation map', () => {
    expect([...declaredArms('element:text_input', 'label')].sort()).toEqual(
      [...specAcceptedArms(ElementTextInputPropsSchema, 'label')].sort(),
    );

    expect(
      diagnose({ type: 'element:text_input', label: I18N_MAP }).filter(
        (d) => d.code === 'type-mismatch',
      ),
    ).toEqual([]);

    // …and the plain-string arm keeps validating clean (that half must not move).
    expect(
      diagnose({ type: 'element:text_input', label: 'Workspace' }).filter(
        (d) => d.code === 'type-mismatch',
      ),
    ).toEqual([]);

    // CONTROL — values matching NEITHER arm are still reported. The spec refuses
    // both (measured above), so the gate must too.
    expect(codesFor({ type: 'element:text_input', label: 42 })).toContain('type-mismatch');
    expect(codesFor({ type: 'element:text_input', label: ['Workspace'] })).toContain(
      'type-mismatch',
    );
  });

  it('`element:text_input.placeholder` accepts the inline translation map', () => {
    expect([...declaredArms('element:text_input', 'placeholder')].sort()).toEqual(
      [...specAcceptedArms(ElementTextInputPropsSchema, 'placeholder')].sort(),
    );

    expect(
      diagnose({ type: 'element:text_input', placeholder: I18N_MAP }).filter(
        (d) => d.code === 'type-mismatch',
      ),
    ).toEqual([]);
    expect(
      diagnose({ type: 'element:text_input', placeholder: 'acme' }).filter(
        (d) => d.code === 'type-mismatch',
      ),
    ).toEqual([]);

    // CONTROL
    expect(codesFor({ type: 'element:text_input', placeholder: true })).toContain('type-mismatch');
    expect(codesFor({ type: 'element:text_input', placeholder: ['acme'] })).toContain(
      'type-mismatch',
    );
  });

  it('`element:text_input.description` accepts the inline translation map', () => {
    // Declared together with the two label-ish keys although its destination in
    // the rendered output differs (a `<p>` below the field, not the `<label>`
    // above it or the native attribute inside it). Destination is not what
    // decides an arm: `ComponentInput.type`'s two conditions are that the
    // contract accepts the shape and the renderer resolves it, and this key
    // satisfies both identically — same `pickLocalized` call site, same
    // `string | Record<string, string>` contract, both measured per key rather
    // than inherited from its neighbours.
    expect([...declaredArms('element:text_input', 'description')].sort()).toEqual(
      [...specAcceptedArms(ElementTextInputPropsSchema, 'description')].sort(),
    );

    expect(
      diagnose({ type: 'element:text_input', description: I18N_MAP }).filter(
        (d) => d.code === 'type-mismatch',
      ),
    ).toEqual([]);
    expect(
      diagnose({ type: 'element:text_input', description: 'We use this to name your workspace.' }).filter(
        (d) => d.code === 'type-mismatch',
      ),
    ).toEqual([]);

    // CONTROL
    expect(codesFor({ type: 'element:text_input', description: 42 })).toContain('type-mismatch');
    expect(codesFor({ type: 'element:text_input', description: ['note'] })).toContain(
      'type-mismatch',
    );
  });

  it('all three on ONE node produce no type-mismatch — the authored shape the card reported', () => {
    // The card's own reproduction: an author writes the map on every key of the
    // trio at once, which is the write the gate used to answer with three
    // warnings. Asserted as a whole node because that is the unit an author
    // saves, and because three keys clean individually would not by itself
    // prove the node is.
    const authored = {
      type: 'element:text_input',
      id: 'ws_input',
      label: I18N_MAP,
      placeholder: I18N_MAP,
      description: I18N_MAP,
    };
    expect(diagnose(authored).filter((d) => d.code === 'type-mismatch')).toEqual([]);

    // CONTROL for the whole-node form: one bad key among three good ones is
    // still reported, so the assertion above cannot be satisfied by a node that
    // stopped being validated.
    expect(
      codesFor({ ...authored, description: ['note'] }),
    ).toContain('type-mismatch');
  });

  it('the widening did NOT reach `defaultValue`, whose contract has no object arm', () => {
    // The per-key control, restated at this block's own altitude. The `it` above
    // for `defaultValue` owns the canonical assertion; this one fails for a
    // DIFFERENT reason — a blanket widening applied to the component rather than
    // to the three keys — and names #5717 so the next reader of a red here knows
    // which change to look at.
    expect(declaredArms('element:text_input', 'defaultValue')).not.toContain('object');
    expect(codesFor({ type: 'element:text_input', defaultValue: I18N_MAP })).toContain(
      'type-mismatch',
    );
  });
});
