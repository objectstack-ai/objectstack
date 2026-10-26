/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The SDUI form-option face stops at the spec's FORM-VIEW option boundary
 * (objectui#12736, triage scoping B).
 *
 * `SelectOption` (`../form`) and its zod twin `SelectOptionSchema`
 * (`../zod/form.zod`) used to derive their spec keys from the OBJECT-field
 * option (`SelectOptionSchema`, `@objectstack/spec/data`), so they accepted
 * spec 18's lifecycle `kind` and the object-only `default` — two keys the
 * spec's form-view option (`FormSelectOptionSchema`, `@objectstack/spec/ui`)
 * leaves out and nothing on the form path reads. Accepted and silently
 * ignored; now refused.
 *
 * ## What this file pins
 *
 *   (a) the zod twin REFUSES a form option carrying `kind`, and one carrying
 *       `default`, each with the issue path naming the key, behind an accepting
 *       control that differs only by that key;
 *   (b) the form face's key set equals `FormSelectOptionSchema`'s plus the
 *       named divergences, by set comparison, on both the type and the runtime
 *       side — the spec half read off the spec, never listed;
 *   (c) `kind` and `default` are not assignable on a typed `SelectOption`
 *       literal;
 *   (d) CONTROL: `SelectOptionBase` and the object-metadata face
 *       `SelectOptionMetadata` still take both, and so does the spec's
 *       object-field option. Only the form-view face narrowed.
 *
 * ## The named divergences, each with its reason
 *
 *   - `value` — WIDENED to `string | number | boolean`: standalone UI forms
 *     bind numeric and boolean values (#3090); the spec's is a lowercase
 *     machine identifier.
 *   - `visibleWhen` — objectui's own wire shape (#2212), a bare string or
 *     `{ dialect?, source }`, kept instead of the spec's envelope-canonicalising
 *     expression pipe.
 *   - `disabled` — objectui-only: a rendered-but-unselectable option. The spec
 *     refuses it by name.
 *   - `icon` — objectui-only: an icon beside the label. The spec refuses it by
 *     name.
 *
 * `value` and `visibleWhen` are spec keys with a different TYPE, so they sit
 * inside the spec's key set; `disabled` and `icon` are the two keys the face
 * adds to it.
 *
 * The type-level `Expect< Equal< … > >` lines are judged by the package
 * `type-check` (its `tsconfig.test.json` leg), not by vitest.
 */

import { describe, it, expect } from 'vitest';
import { SelectOptionSchema as SpecSelectOptionSchema } from '@objectstack/spec/data';
import type { SelectOption as SpecSelectOption } from '@objectstack/spec/data';
import { FormSelectOptionSchema as SpecFormSelectOptionSchema } from '@objectstack/spec/ui';
import type { FormSelectOption as SpecFormSelectOption } from '@objectstack/spec/ui';

import { SelectOptionSchema } from '../zod/form.zod';
import type { SelectOption } from '../form';
import type { SelectOptionBase } from '../select-option';
import type { SelectOptionMetadata } from '../field-types';

/* ── Type-level helpers ──────────────────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/** The two keys the face adds to the spec's form-view option. */
type FormFaceAddedKey = 'disabled' | 'icon';

/** The object-field option's keys the form-view option leaves out — derived. */
type ObjectFieldOnlyKey = Exclude< keyof SpecSelectOption, keyof SpecFormSelectOption >;

/* ── (b) The key set, type side ──────────────────────────────────────────── */

/** The form face's keys are exactly the form-view option's plus the two it adds. */
export type assertionFormFaceKeysAreTheFormViewOptionsPlusDivergences =
  Expect< Equal< keyof SelectOption, keyof SpecFormSelectOption | FormFaceAddedKey > >;

/** The derived difference is what the card names, so the pin is not vacuous. */
export type assertionObjectFieldOnlyKeysAreDefaultAndKind =
  Expect< Equal< ObjectFieldOnlyKey, 'default' | 'kind' > >;

/** `value` is the widened divergence. */
export type assertionValueIsWidened =
  Expect< Equal< SelectOption['value'], string | number | boolean > >;

/** `visibleWhen` is objectui's wire shape, optional. */
export type assertionVisibleWhenIsTheWireShape =
  Expect< Equal< SelectOption['visibleWhen'], string | { dialect?: string; source: string } | undefined > >;

/**
 * Every OTHER spec key is the spec's own member, unchanged — so the face did
 * not restate one of them at a different type.
 */
export type assertionOtherSpecKeysAreTheSpecMembers =
  Expect< Equal<
    Pick< SelectOption, Exclude< keyof SpecFormSelectOption, 'value' | 'visibleWhen' > >,
    Pick< SpecFormSelectOption, Exclude< keyof SpecFormSelectOption, 'value' | 'visibleWhen' > >
  > >;

/* ── (c) `kind` and `default` are not assignable on the form face ────────── */

export const refusesKindOnFormFace = (): SelectOption => ({
  label: 'Closed won',
  value: 'closed_won',
  // @ts-expect-error `kind` is an object-field option key; the form-view option does not take it.
  kind: 'won',
});

export const refusesDefaultOnFormFace = (): SelectOption => ({
  label: 'Closed won',
  value: 'closed_won',
  // @ts-expect-error `default` is an object-field option key; the form-view option does not take it.
  default: true,
});

/** Control for the two refusals: the same literal minus the key compiles. */
export const acceptsTheSameOptionWithoutEither = (): SelectOption => ({
  label: 'Closed won',
  value: 'closed_won',
  color: '#22c55e',
  description: 'Signed',
  visibleWhen: "record.stage == 'closing'",
  disabled: false,
  icon: 'trophy',
});

/* ── (d) CONTROL: the base and the object-metadata face keep both ────────── */

export const baseStillTakesKindAndDefault = (): SelectOptionBase => ({
  label: 'Closed won',
  value: 'closed_won',
  kind: 'won',
  default: true,
});

export const metadataFaceStillTakesKindAndDefault = (): SelectOptionMetadata => ({
  label: 'Closed won',
  value: 'closed_won',
  kind: 'won',
  default: true,
});

export type assertionBaseKeepsKindAndDefault =
  Expect< Equal< Extract< keyof SelectOptionBase, 'kind' | 'default' >, 'kind' | 'default' > >;
export type assertionMetadataFaceKeepsKindAndDefault =
  Expect< Equal< Extract< keyof SelectOptionMetadata, 'kind' | 'default' >, 'kind' | 'default' > >;

/* ── Runtime ─────────────────────────────────────────────────────────────── */

/** A valid form option: `value` is a machine identifier well over the minimum. */
const CONTROL = { label: 'Closed won', value: 'closed_won' } as const;

const formViewKeys = Object.keys(SpecFormSelectOptionSchema.shape).sort();
const objectFieldOnlyKeys = Object.keys(SpecSelectOptionSchema.shape).filter((k) => !formViewKeys.includes(k)).sort();

/** The issues naming `key` in their path, as `code@path`. */
const issuesAt = (result: ReturnType< typeof SelectOptionSchema.safeParse >, key: string) =>
  result.success
    ? []
    : result.error.issues.filter((i) => i.path[0] === key).map((i) => `${i.code}@${i.path.join('.')}`);

describe('the form option stops at the spec form-view option boundary (objectui#12736)', () => {
  it('(a) CONTROL: the option minus the object-field-only keys is accepted', () => {
    expect(SelectOptionSchema.safeParse(CONTROL).success).toBe(true);
  });

  for (const [key, value] of [
    ['kind', 'won'],
    ['default', true],
  ] as const) {
    it(`(a) refuses \`${key}\` by name, not silently`, () => {
      const res = SelectOptionSchema.safeParse({ ...CONTROL, [key]: value });
      expect(res.success).toBe(false);
      // The refusal's kind and the key it names; the guidance wording is not pinned.
      expect(issuesAt(res, key)).toEqual([`invalid_type@${key}`]);
    });
  }

  it('(b) the derived difference of the two spec shapes is `default` and `kind`', () => {
    expect(objectFieldOnlyKeys).toEqual(['default', 'kind']);
  });

  it('(b) the twin states the form-view keys, the two UI-only keys, and the refusals — nothing else', () => {
    const localKeys = Object.keys(SelectOptionSchema.shape).sort();
    expect(localKeys).toEqual([...formViewKeys, 'disabled', 'icon', ...objectFieldOnlyKeys].sort());
  });

  it('(b) the spec agrees: its form-view option refuses both keys by name', () => {
    const res = SpecFormSelectOptionSchema.safeParse({ ...CONTROL, kind: 'won', default: true });
    expect(res.success).toBe(false);
    const keys = res.success ? [] : res.error.issues.flatMap((i) => ('keys' in i ? (i.keys as string[]) : []));
    expect(keys.sort()).toEqual(['default', 'kind']);
    expect(SpecFormSelectOptionSchema.safeParse(CONTROL).success).toBe(true);
  });

  it('(d) CONTROL: the spec object-field option still takes `kind` and `default`', () => {
    expect(SpecSelectOptionSchema.safeParse({ ...CONTROL, kind: 'won', default: true }).success).toBe(true);
  });
});
