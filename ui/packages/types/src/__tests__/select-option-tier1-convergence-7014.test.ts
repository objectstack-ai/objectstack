// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two named select-option faces are ONE declaration now, and converging
 * them narrowed nothing (objectui#7014, Q1).
 *
 * ## What changed
 *
 * `SelectOptionMetadata` (`../field-types`, the object-metadata read model) and
 * `SelectOption` (`../form`, the SDUI form vocabulary) each restated the
 * select-option vocabulary by hand. Both now extend `SelectOptionBase`
 * (`../select-option`), which derives the spec's keys from
 * `@objectstack/spec/data` BY REFERENCE and writes out only the divergences.
 *
 * ## What this file pins, and why each half is needed
 *
 * A convergence has exactly two ways to go wrong, and they fail in opposite
 * directions, so neither half can stand alone:
 *
 *   1. **It narrows something.** A "unification" quietly drops a key one face
 *      had, or tightens a member's type, and every literal that used the
 *      dropped key becomes an excess-property error somewhere else. The
 *      `PRE_CONVERGENCE_*` types below are the two faces' member lists AS THEY
 *      STOOD BEFORE, written out by hand from the declarations, and each is
 *      asserted INVARIANTLY equal to what the converged face resolves to today.
 *      `Equal`, not `extends`: a one-way check passes on a narrowing.
 *
 *   2. **It widens past the authoring contract without saying so.** The
 *      objectui faces are deliberately WIDER than the spec — that is the point
 *      of the dialect keys — but only the runtime READ model may be wider.
 *      The runtime block asserts the spec still refuses every dialect key BY
 *      NAME, each refusal behind a control that accepts the same document minus
 *      the key, so a red here reads "the key's status changed" and never "the
 *      fixture drifted".
 *
 * The one deliberate widening this convergence DOES make is `default` on the
 * object-metadata face: it is a spec key that face could not describe before,
 * ruled `enforce` on the object-field face (objectstack#7246), and it arrives
 * as an OPTIONAL key, so every document that face accepted before it is still
 * accepted. It is asserted below rather than left implicit.
 *
 * ## ⭐ What `@objectstack/spec` 17.3.0 changed here, and why nothing was edited
 *
 * 17.3.0 adopted `SelectOptionSchema.description` (maintainer ruling
 * 2026-08-25 on objectui#6140 / objectui#6153, Option A). `SelectOptionBase`
 * derives the spec's keys BY REFERENCE, so the key arrived on BOTH faces with
 * no edit to `../select-option` at all — which is exactly the property the
 * derivation exists to have, and it is worth saying out loud that the pins
 * below moved while the type did not.
 *
 * Two consequences are written into the assertions rather than left implicit:
 *
 *   1. The FORM face gained a member it never declared, so its
 *      pre-convergence equality became a SET DIFFERENCE — the same idiom the
 *      object-metadata face has used for `default` since the convergence. A
 *      plain `Equal` there would now have to be repaired every time the spec
 *      grows, which is the hand-copy failure this file exists to prevent.
 *   2. The two faces no longer differ on `description` — it is inherited on
 *      both — so the "differ on exactly `value`" assertion states that
 *      directly instead of excusing `description` from the comparison.
 *
 * The runtime half moved the same way: `description` is asserted ACCEPTED, and
 * `disabled` / `icon` carry the refusal half so a schema that had gone
 * permissive cannot pass this file.
 *
 * ## ⭐ What `@objectstack/spec` 18 changed here, and why it is written as a widening
 *
 * Spec 18 adds an OPTIONAL `kind: 'open' | 'won' | 'lost'` to
 * `SelectOptionSchema` (objectstack#23809, landed as objectstack#23846): the
 * option's lifecycle category. It arrives on both faces by reference, exactly as
 * `description` did, so the gained-key sets below are `'description'` /
 * `'default'` PLUS `kind`. That is a deliberate optional widening, stated here
 * rather than absorbed: the `PRE_CONVERGENCE_*` records are not edited, and
 * `kind` is not `Omit`ted from either face.
 *
 * `kind` is spelled through {@link SpecKindKey}, which is `'kind'` when the spec
 * in use declares it and `never` when it does not, read off the spec's OWN type
 * rather than a version check. The repo's `Type Check` compiles against the
 * installed spec and objectstack's hourly Spec Shape Gate against the spec built
 * from objectstack `main`, and these pins must hold on both until the two meet.
 * Any OTHER key the spec adds still turns every set difference red.
 *
 * ## ⭐ What objectui#12736 changed here: the FORM face left `default` and `kind`
 *
 * The form face used to keep both although the spec's form-VIEW options
 * (`FormSelectOptionSchema`) leave them out; objectui#12711 named that as a face
 * change of its own. objectui#12736 (triage scoping B) made it: `SelectOption`
 * now drops the keys the form-view option leaves out, derived as the set
 * difference of the spec's two option types, and its zod twin refuses them by
 * name. So on the FORM face only, the pins below are edited deliberately:
 *
 *   - "kept every member" now excuses `default`, the one pre-convergence member
 *     the narrowing removed, and `PRE_CONVERGENCE_SelectOption` stays verbatim;
 *   - "gained only" is `description` alone — `kind` is no longer gained;
 *   - the `kind`-is-optional pin is replaced by a pin that the face has no `kind`;
 *   - the two faces now differ on `value` AND on the object-field-only keys.
 *
 * The OBJECT-metadata face and `SelectOptionBase` are untouched: the spec takes
 * `kind` and `default` on a select or radio field's options, and their pins
 * below are unchanged. The form face's full key set is pinned against
 * `FormSelectOptionSchema` by `select-option-form-view-boundary-12736.test.ts`.
 *
 * ## The control the spec fixtures need
 *
 * A select option's `value` is a lowercase machine identifier with a minimum
 * length, so a one-character value fails `too_small` and NOT for the reason a
 * key-boundary fixture is asking about. Every fixture here uses a value long
 * enough that the only thing under test is the key set, and the accepting
 * control proves it.
 */

import { describe, it, expect } from 'vitest';
import { SelectOptionSchema as SpecSelectOptionSchema } from '@objectstack/spec/data';
import type { SelectOption as SpecSelectOption } from '@objectstack/spec/data';

import type { SelectOptionBase } from '../select-option';
import type { SelectOptionMetadata } from '../field-types';
import type { SelectOption } from '../form';

/* ── Type-level helpers ──────────────────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/** objectui's own expression wire shape (objectui#2212), as both faces declared it. */
type ExpressionWire = string | { dialect?: string; source: string };

/**
 * `'kind'` when the spec in use declares the option's lifecycle category
 * (spec 18, objectstack#23846), `never` when it does not. Read off the spec's
 * own type, so the pins below hold on both spec lines without a version check,
 * and the day the installed spec carries `kind` this is simply `'kind'`.
 */
type SpecKindKey = Extract< keyof SpecSelectOption, 'kind' >;

/* ── 1. No narrowing: the pre-convergence member lists, verbatim ─────────── */

/**
 * `SelectOption` as `../form` declared it before the convergence — seven
 * members, `value` widened for standalone forms.
 */
interface PRE_CONVERGENCE_SelectOption {
  label: string;
  value: string | number | boolean;
  disabled?: boolean;
  icon?: string;
  color?: string;
  default?: boolean;
  visibleWhen?: ExpressionWire;
}

/**
 * `SelectOptionMetadata` as `../field-types` declared it before the
 * convergence — seven members, `value` the spec's identifier, `description`
 * the read-model extension, and NO `default` (the gap this convergence closes).
 */
interface PRE_CONVERGENCE_SelectOptionMetadata {
  label: string;
  value: string;
  description?: string;
  color?: string;
  icon?: string;
  disabled?: boolean;
  visibleWhen?: ExpressionWire;
}

/**
 * The SDUI form face kept every member it had, at the same type, EXCEPT
 * `default` — stated by removing the key the spec has since added
 * (`description`) and comparing what is left against the record minus `default`.
 * `PRE_CONVERGENCE_SelectOption` above is a HISTORICAL record and is never
 * edited to match; it is the fixed end of this comparison.
 *
 * EDITED by objectui#12736: the comparison used to be against the whole record.
 * `default` is excused because the form face deliberately dropped it — the
 * spec's form-view option leaves it out and nothing on the form path read it —
 * not because the comparison was loosened: every OTHER member is still compared
 * invariantly.
 */
export type assertionFormFaceKeptEveryMember =
  Expect< Equal< Omit< SelectOption, 'description' >, Omit< PRE_CONVERGENCE_SelectOption, 'default' > > >;

/**
 * …and `description` is ALL it gained since. Written as a set difference so
 * another key cannot ride along silently: add one and this stops being
 * `'description'`.
 *
 * EDITED by objectui#12736: it was `'description' | SpecKindKey`. Spec 18's
 * `kind` no longer arrives on the FORM face — the spec's form-view option does
 * not take it — so a `kind` that came back would turn this red.
 */
export type assertionFormFaceGainedOnlyDescription =
  Expect< Equal< Exclude< keyof SelectOption, keyof PRE_CONVERGENCE_SelectOption >, 'description' > >;

/**
 * …and the one member it lost is `default` (objectui#12736). Stated as its own
 * set difference so the excusal above cannot hide a second loss.
 */
export type assertionFormFaceLostOnlyDefault =
  Expect< Equal< Exclude< keyof PRE_CONVERGENCE_SelectOption, keyof SelectOption >, 'default' > >;

/** …and it arrived OPTIONAL, so no form that type-checked before now fails. */
export type assertionDescriptionIsOptional =
  Expect< Equal< SelectOption['description'], string | undefined > >;

/**
 * The object-metadata face kept every member it had, at the same type — the
 * no-narrowing half, stated by removing the keys that were added (`default`,
 * and `kind` where the spec declares it) and comparing what is left.
 */
export type assertionMetadataFaceKeptEveryMember =
  Expect< Equal< Omit< SelectOptionMetadata, 'default' | SpecKindKey >, PRE_CONVERGENCE_SelectOptionMetadata > >;

/**
 * …and `default` (plus spec 18's `kind`) is ALL it gained. Written as a set
 * difference so another key cannot ride along silently: add one and this
 * stops being `'default' | SpecKindKey`.
 */
export type assertionMetadataFaceGainedOnlyDefaultAndKind =
  Expect< Equal< Exclude< keyof SelectOptionMetadata, keyof PRE_CONVERGENCE_SelectOptionMetadata >, 'default' | SpecKindKey > >;

/** …and `default` really is optional, so no document that parsed before now fails. */
export type assertionDefaultIsOptional =
  Expect< Equal< SelectOptionMetadata['default'], boolean | undefined > >;

/**
 * `kind`, where the spec declares it, is OPTIONAL on the object-metadata face —
 * so no option that type-checked before now fails — and it is the spec's own
 * member, by reference, not a restatement. Both read `{}` on a spec without
 * `kind`.
 *
 * EDITED by objectui#12736: the FORM face's half of this pin
 * (`assertionKindIsOptionalOnFormFace`) is replaced by the one after these,
 * because the form face no longer carries `kind` at all.
 */
export type assertionKindIsOptionalOnMetadataFace =
  Expect< Equal< Pick< SelectOptionMetadata, SpecKindKey >, Partial< Pick< SelectOptionMetadata, SpecKindKey > > > >;
export type assertionKindIsTheSpecMember =
  Expect< Equal< Pick< SelectOptionMetadata, SpecKindKey >, Pick< SpecSelectOption, SpecKindKey > > >;

/**
 * The FORM face carries neither object-field-only key (objectui#12736): the
 * spec's form-view option takes neither, so the face does not either.
 */
export type assertionFormFaceHasNoKindOrDefault =
  Expect< Equal< Extract< keyof SelectOption, 'kind' | 'default' >, never > >;

/**
 * The two faces differ on `value` and on the object-field-only keys, and on
 * nothing else.
 *
 * `description` used to be excused from this comparison because only the
 * object-metadata face declared it; 17.3.0 put it in the derivation, so both
 * faces carry it and the comparison states the difference without an
 * exemption. Re-adding one here would hide the next divergence.
 *
 * EDITED by objectui#12736: it was "differ on exactly `value`". The FORM face
 * now leaves out `default` and spec 18's `kind`, which the object-metadata face
 * keeps; they are excused from the METADATA side only, so a key the form face
 * gained or lost beyond them still turns this red.
 */
export type assertionOnlyValueAndObjectFieldOnlyKeysDiffer =
  Expect< Equal< Omit< SelectOption, 'value' >, Omit< SelectOptionMetadata, 'value' | 'default' | SpecKindKey > > >;
export type assertionFormValueIsWide =
  Expect< Equal< SelectOption['value'], string | number | boolean > >;
export type assertionMetadataValueIsSpecIdentifier =
  Expect< Equal< SelectOptionMetadata['value'], string > >;

/* ── 2. The base carries every spec key, checked on BOTH sides ───────────── */

/**
 * The spec's key names, each annotated as a member of the derived base. The
 * ANNOTATION is the type-side half — drop a key from the base and this stops
 * compiling — and the runtime assertion below is the other half: add a key to
 * the spec and the lists stop agreeing. Neither half alone is a pin.
 *
 * `kind` is not in this list because the installed spec may not declare it, and
 * a member the base lacks cannot be annotated here. It is the one named
 * addition the runtime comparison allows, on its own pin below
 * ({@link SPEC_KIND_KEY}); any other new spec key still breaks the comparison.
 */
const SPEC_KEYS_ON_BASE: readonly (keyof SelectOptionBase)[] = [
  'color',
  'default',
  'description',
  'label',
  'value',
  'visibleWhen',
];

/**
 * Spec 18's lifecycle category (objectstack#23846). Present in the spec's shape
 * exactly when {@link SpecKindKey} is `'kind'` on the type side.
 */
const SPEC_KIND_KEY = 'kind';

/** The objectui-only keys, annotated the same way. */
const DIALECT_KEYS_ON_BASE: readonly (keyof SelectOptionBase)[] = ['disabled', 'icon'];

/* ── 3. Neither face admits a key nobody declares ────────────────────────── */

export const rejectsUndeclaredKeyOnFormFace = (): SelectOption => ({
  label: 'High priority',
  value: 'high_priority',
  // @ts-expect-error `weight` is declared by neither the spec nor this repo.
  weight: 3,
});

export const rejectsUndeclaredKeyOnMetadataFace = (): SelectOptionMetadata => ({
  label: 'High priority',
  value: 'high_priority',
  // @ts-expect-error `weight` is declared by neither the spec nor this repo.
  weight: 3,
});

/**
 * The control for the two refusals above: the SAME literal carrying every key
 * the converged faces DO declare compiles with no error. Without it, a face
 * that had gone `never` would pass both `@ts-expect-error` cases vacuously.
 *
 * Spec 18's `kind` is not written into these literals: it would be an excess
 * property against a spec that does not declare it. That it is accepted where
 * declared, and optional, is the `assertionKindIs*` pins above; that `weight`
 * is still refused next to it shows the face did not go permissive with it.
 */
export const acceptsEveryDeclaredKey = (): SelectOptionMetadata => ({
  label: 'High priority',
  value: 'high_priority',
  color: '#ef4444',
  default: true,
  visibleWhen: { dialect: 'cel', source: "record.stage == 'open'" },
  description: 'Blocks the release',
  disabled: false,
  icon: 'flame',
});

// EDITED by objectui#12736: `default: false` left this literal — the form face
// no longer declares it, and `select-option-form-view-boundary-12736.test.ts`
// pins its refusal.
export const acceptsEveryDeclaredKeyOnFormFace = (): SelectOption => ({
  label: 'Ten',
  value: 10,
  color: '#ef4444',
  visibleWhen: "'admin' in current_user.positions",
  description: 'Blocks the release',
  disabled: true,
  icon: 'hash',
});

/* ── Runtime ─────────────────────────────────────────────────────────────── */

/** A valid spec option: `value` is a machine identifier well over the minimum. */
const CONTROL = { label: 'High priority', value: 'high_priority' } as const;

/** The `unrecognized_keys` issue naming `key`, or undefined. */
const refusedByName = (
  result: { success: boolean; error?: { issues: readonly { code: string; keys?: readonly string[] }[] } },
  key: string,
) =>
  result.success
    ? undefined
    : result.error!.issues.find((i) => i.code === 'unrecognized_keys' && (i.keys ?? []).includes(key));

describe('the derived base carries the spec vocabulary', () => {
  it('lists exactly the keys the spec declares (plus `kind` where the spec declares it)', () => {
    const specKeys = Object.keys(SpecSelectOptionSchema.shape);
    const expected = specKeys.includes(SPEC_KIND_KEY)
      ? [...SPEC_KEYS_ON_BASE, SPEC_KIND_KEY]
      : [...SPEC_KEYS_ON_BASE];
    expect(expected.sort()).toEqual(specKeys.sort());
  });

  it('`kind` is either an OPTIONAL spec key, or refused by name — never silently absorbed', () => {
    const withKind = SpecSelectOptionSchema.safeParse({ ...CONTROL, kind: 'won' });
    if (Object.keys(SpecSelectOptionSchema.shape).includes(SPEC_KIND_KEY)) {
      // Spec 18: accepted, and absent stays absent (it is optional, not defaulted).
      expect(withKind.success).toBe(true);
      const bare = SpecSelectOptionSchema.safeParse(CONTROL);
      expect(bare.success && SPEC_KIND_KEY in bare.data).toBe(false);
      // …and the schema has not gone permissive on the value: a category it
      // does not declare is refused.
      expect(SpecSelectOptionSchema.safeParse({ ...CONTROL, kind: 'closed' }).success).toBe(false);
    } else {
      // A spec before 18: `kind` is an undeclared key like any other.
      expect(refusedByName(withKind, SPEC_KIND_KEY)).toBeDefined();
    }
    // Control: the same option minus the key parses on either line.
    expect(SpecSelectOptionSchema.safeParse(CONTROL).success).toBe(true);
  });

  it('CONTROL: a clean option is accepted, and for the stated reason', () => {
    const res = SpecSelectOptionSchema.safeParse(CONTROL);
    expect(res.success).toBe(true);
    // …and the reason really is "no extra key, valid value": a one-character
    // value fails for a DIFFERENT reason, which is what makes the ACCEPT above
    // a reading rather than luck.
    const short = SpecSelectOptionSchema.safeParse({ label: 'H', value: 'h' });
    expect(short.success).toBe(false);
    expect(short.success ? [] : short.error.issues.map((i) => i.code)).toContain('too_small');
  });

  it('accepts an option carrying every spec key at once', () => {
    const res = SpecSelectOptionSchema.safeParse({
      ...CONTROL,
      color: '#ef4444',
      default: true,
      visibleWhen: "record.stage == 'open'",
    });
    expect(res.success).toBe(true);
  });
});

describe('the objectui dialect keys sit OUTSIDE that vocabulary', () => {
  it('names the dialect keys the base adds', () => {
    expect([...DIALECT_KEYS_ON_BASE].sort()).toEqual(['disabled', 'icon']);
    // Neither is a spec key — the two lists are disjoint.
    const specKeys = Object.keys(SpecSelectOptionSchema.shape);
    expect(DIALECT_KEYS_ON_BASE.filter((k) => specKeys.includes(k as string))).toEqual([]);
  });

  for (const [key, value] of [
    ['disabled', true],
    ['icon', 'flame'],
  ] as const) {
    it(`the spec refuses \`${key}\` BY NAME, with the same option minus the key accepted`, () => {
      const res = SpecSelectOptionSchema.safeParse({ ...CONTROL, [key]: value });
      expect(res.success).toBe(false);
      expect(refusedByName(res, key), `expected unrecognized_keys naming '${key}'`).toBeDefined();
      // Control, per fixture: the key is the only difference.
      expect(SpecSelectOptionSchema.safeParse(CONTROL).success).toBe(true);
    });
  }

  it('`description` is NOT one of them — 17.3.0 moved it inside the vocabulary', () => {
    // The counterpart of the two refusals above, and the reason this file's
    // dialect list is two keys and not three: `description` was an
    // objectui-only key until the 2026-08-25 ruling declared it, so it is
    // asserted ACCEPTED here rather than quietly dropped from the loop.
    const res = SpecSelectOptionSchema.safeParse({ ...CONTROL, description: 'Blocks the release' });
    expect(res.success).toBe(true);
    expect(refusedByName(res, 'description')).toBeUndefined();
    // Control: the schema has not gone permissive — it still refuses by name.
    expect(
      refusedByName(SpecSelectOptionSchema.safeParse({ ...CONTROL, icon: 'flame' }), 'icon'),
    ).toBeDefined();
  });

  it('a fully-populated read-model option is refused as a whole, naming the two still outside', () => {
    const readModel: SelectOptionMetadata = {
      label: 'High priority',
      value: 'high_priority',
      color: '#ef4444',
      default: true,
      description: 'Blocks the release',
      disabled: false,
      icon: 'flame',
    };
    const res = SpecSelectOptionSchema.safeParse(readModel);
    expect(res.success).toBe(false);
    for (const key of ['disabled', 'icon']) {
      expect(refusedByName(res, key), `expected unrecognized_keys naming '${key}'`).toBeDefined();
    }
    // …and `description` is NOT among them. Stated positively, because the
    // whole-document refusal would still be red with `description` refused too,
    // and this file would then be pinning a boundary the contract has left.
    expect(refusedByName(res, 'description')).toBeUndefined();

    // Control: the same document with only the spec keys parses.
    const { disabled: _di, icon: _i, ...specOnly } = readModel;
    expect(SpecSelectOptionSchema.safeParse(specOnly).success).toBe(true);
  });
});
