/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5874 — `resolveActionParams`' private copy of the reference-bearing
 * field family converges onto `@object-ui/core`'s `EXPANDABLE_FIELD_TYPES`.
 *
 * The copy was `resolvedType === 'lookup' || resolvedType === 'reference'`,
 * the test gating `lookupExtras` — the picker config (`referenceTo`,
 * `displayField`, `idField`, …) this resolver copies off the underlying object
 * field and `paramToField()` then forwards to `<LookupField>`. Neither derived
 * from nor pinned against the shared set.
 *
 * ## Why the load-bearing pin is IDENTITY, not membership
 *
 * Every membership assertion below is satisfied by a private
 * `new Set(['lookup', 'master_detail', 'tree', 'user'])` holding the same
 * strings — i.e. by a re-fork of exactly the kind this change removed. So the
 * pin that decides the convergence spies on the `has` of the object core
 * exports: a call is recorded only if the face under test consulted THAT
 * object, so a member-identical private copy leaves the spy empty and fails
 * here, where a value check would pass ON the defect. Same shape as
 * objectui#4770 / #4790 / #4815 / #5312 / #5692.
 *
 * ## This face's membership delta is THREE members, not two
 *
 * Unlike its three sibling faces in objectui#5874 it also lacked
 * `master_detail`, so a field-backed `master_detail` param inherited no picker
 * config at all and `paramToField()` then degraded it to a plain record-id text
 * input — the unexplained "paste a UUID" box objectui#3405 exists to prevent.
 *
 * `reference` is the one member that does NOT drop on this face, and that is a
 * measurement rather than an omission: it is undeclarable (refused by the
 * spec's `ActionParamSchema`, pinned below with live and dead controls), but
 * the dialog still ACCEPTS it from params already authored with it, via
 * `PARAM_TYPE_ALIASES` in `paramToField.ts`, which folds it to `lookup`. The
 * convergence therefore asks the shared set over the widget key
 * `resolveParamWidgetType()` produces — one alias table, read not copied, and
 * the SAME expression `paramToField()` evaluates one step later.
 *
 * Ablation direction, predicted before running: restore the private copy
 * (`resolvedType === 'lookup' || resolvedType === 'reference'`) and the
 * identity pin goes RED (the spy records no call) while a member-set assertion
 * over `EXPANDABLE_FIELD_TYPES` stays GREEN — that contrast is the whole
 * reason the pin is on identity. The restoration probes go red too; the
 * ordinary-relation control stays green in both directions, which is what
 * makes it a control rather than a duplicate of the pins.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EXPANDABLE_FIELD_TYPES } from '@object-ui/core';
import { FieldType } from '@objectstack/spec/data';
import { enumOptions } from '@object-ui/test-support';
import { ActionParamSchema } from '@objectstack/spec/ui';
import {
  resolveActionParams,
  type ResolveActionParamsContext,
  type RawActionParam,
} from '@object-ui/fields';

/**
 * The spec's own `FieldType` vocabulary.
 *
 * The wrapper walk is `@object-ui/test-support`'s shared reader (objectui#6924);
 * the THROW stays HERE, because the reader deliberately answers `[]` rather than
 * raising and this read is module-scope. What it replaces was a NON-OPTIONAL
 * cast of the enum node to an options-bearing shape, spread directly — which
 * failed LOUDLY the moment the cast stopped holding (spreading `undefined`
 * throws), so a bare `enumOptions` call here would have traded a loud failure
 * for a silently empty vocabulary: every assertion below would then pass over
 * nothing. That trade is the regression objectui#7025 exists to refuse. (The
 * retired spelling is deliberately NOT quoted here: the card's enumeration
 * instrument is a grep for it, and a comment carrying the literal text makes
 * every future re-derivation of this population read a false positive.)
 */
const readSpecFieldTypes = (): readonly string[] => {
  const options = enumOptions(FieldType);
  if (options.length === 0) {
    throw new Error('could not read FieldType.options from @objectstack/spec');
  }
  return options;
};

const SPEC_FIELD_TYPES: readonly string[] = readSpecFieldTypes();

/** Every picker key `lookupExtras` copies off the resolved object field. */
const PICKER_KEYS = [
  'referenceTo',
  'displayField',
  'idField',
  'descriptionField',
  'titleFormat',
  'lookupColumns',
  'lookupFilters',
  'lookupPageSize',
  'dependsOn',
] as const;

/**
 * One object field per relevant type, each carrying full picker config.
 *
 * ⚠️ The spellings here are MIXED, and deliberately so — this fixture is about
 * WHICH members inherit picker config, never about how a key is spelled. Most
 * rows stay snake because `resolveActionParams` really does read that spelling
 * (some as the only spelling it reads, some behind the declared one).
 *
 * ⭐ `dependsOn` is the exception and must stay camel (objectui#8672, ruling A).
 * It was `depends_on: ['region']` and passed only because the resolver read the
 * snake spelling — a spelling `@objectstack/spec`'s `FieldSchema` refuses BY
 * NAME. Ruling A moved that read onto the declared `dependsOn` and removed the
 * snake leg, so the old fixture row silently produced nothing and the
 * `PICKER_KEYS` loop below caught it. ⛔ Do not "fix" a future failure here by
 * restoring a dual read: the key is camelCase-only on both sides of the seam.
 *
 * ⭐ `displayField` is camel for the same reason (objectui#11070 round 6): the
 * resolver's `display_field` leg is retired, so the snake row would produce
 * nothing. `lookupColumns` and `lookupPageSize` followed (objectui#12157).
 */
const field = (type: string) => ({
  type,
  label: type,
  reference: 'accounts',
  displayField: 'name',
  id_field: 'id',
  description_field: 'website',
  title_format: '{name}',
  lookupColumns: ['name'],
  lookup_filters: [['active', '=', true]],
  lookupPageSize: 25,
  dependsOn: ['region'],
});

const ctx = (): ResolveActionParamsContext => ({
  objectName: 'deal',
  objects: [
    {
      name: 'deal',
      fields: {
        account: field('lookup'),
        parent_deal: field('master_detail'),
        assignee: field('user'),
        parent_node: field('tree'),
        stage: { type: 'select', label: 'Stage' },
        title: { type: 'text', label: 'Title' },
      },
    },
  ],
  fieldLabel: (_o, _f, fallback) => fallback,
});

const resolveOne = (param: RawActionParam) => resolveActionParams([param], ctx())[0];

afterEach(() => {
  // The pins install a spy on the Set object EXPORTED by core — a shared,
  // module-level object. A leaked spy would follow every later file in the
  // worker, so restoring is not optional here.
  vi.restoreAllMocks();
});

describe("resolveActionParams' reference rule is core's object, not a copy (objectui#5874)", () => {
  it('asks `@object-ui/core` EXPANDABLE_FIELD_TYPES which params carry picker config', () => {
    // The spy is installed on the Set exported by core and records a call only
    // if THIS module consulted THAT object. A member-identical private copy
    // leaves it empty, so this fails where a value check would pass.
    const spy = vi.spyOn(EXPANDABLE_FIELD_TYPES, 'has');
    try {
      resolveOne({ field: 'account' });
      expect(spy.mock.calls.map(([k]) => k)).toContain('lookup');
    } finally {
      spy.mockRestore();
    }
  });

  it('reaches that object on the person path too, not just the lookup path', () => {
    // `user` and `lookup` are different members of the same set; a convergence
    // that reconnected one spelling only would leave the other forked.
    const spy = vi.spyOn(EXPANDABLE_FIELD_TYPES, 'has');
    try {
      resolveOne({ field: 'assignee' });
      expect(spy.mock.calls.map(([k]) => k)).toContain('user');
    } finally {
      spy.mockRestore();
    }
  });

  it('a member-identical private copy would NOT satisfy the pin — the contrast', () => {
    // Documents, executably, why the two pins above are not membership checks:
    // this assertion is true of the shared object AND of any private set
    // holding the same strings, so it cannot tell a converged face from a
    // re-forked one. The spies above can.
    const memberIdenticalCopy = new Set(['lookup', 'master_detail', 'tree', 'user']);
    expect([...EXPANDABLE_FIELD_TYPES].sort()).toEqual([...memberIdenticalCopy].sort());
    expect(EXPANDABLE_FIELD_TYPES).not.toBe(memberIdenticalCopy);
  });
});

describe('the restoration half — members this face was missing (objectui#5874)', () => {
  // Each must be able to FAIL: before the convergence every one of these params
  // reached `paramToField()` with no `referenceTo`, which degrades it to a
  // plain record-id text input.
  it.each([
    ['master_detail', 'parent_deal'],
    ['user', 'assignee'],
    ['tree', 'parent_node'],
  ])('a %s param now inherits the full picker config', (_type, fieldName) => {
    const out = resolveOne({ field: fieldName });
    for (const key of PICKER_KEYS) {
      expect(out[key], `${fieldName} lost ${key}`).toBeDefined();
    }
    expect(out.referenceTo).toBe('accounts');
    expect(out.displayField).toBe('name');
  });

  it('`lookup` — the one member that already worked — is untouched', () => {
    const out = resolveOne({ field: 'account' });
    expect(out.referenceTo).toBe('accounts');
    expect(out.displayField).toBe('name');
  });
});

describe('a type outside the family is still NOT reference-bearing — the control', () => {
  // Without this, "converge" would be satisfiable by handing picker config to
  // every param. It must stay green through BOTH ablation legs.
  it.each([
    ['select', 'stage'],
    ['text', 'title'],
  ])('a %s param carries no picker config', (_type, fieldName) => {
    const out = resolveOne({ field: fieldName });
    for (const key of PICKER_KEYS) {
      expect(out[key], `${fieldName} gained ${key}`).toBeUndefined();
    }
  });
});

describe('`reference` survives HERE, and only through the alias table', () => {
  /**
   * The measurement, kept as an executable pin rather than as prose in a PR.
   * Controls run on the same read as the subject, so a probe that had lost hold
   * of the vocabulary (an empty list, the wrong export) fails as a broken probe
   * instead of reporting the subject absent.
   */
  it('every LIVE control IS a spec `FieldType`, and every DEAD one is not', () => {
    for (const type of EXPANDABLE_FIELD_TYPES) {
      expect(SPEC_FIELD_TYPES, `'${type}' is not a spec FieldType`).toContain(type);
    }
    expect(SPEC_FIELD_TYPES).not.toContain('owner');
    expect(SPEC_FIELD_TYPES).not.toContain('zzz_not_a_field_type');
  });

  it('SUBJECT — an author cannot DECLARE a `reference` param', () => {
    // Live controls first: if these stopped parsing, the subject reading below
    // would mean nothing.
    for (const type of EXPANDABLE_FIELD_TYPES) {
      expect(
        ActionParamSchema.safeParse({ name: 'p', label: 'P', type, reference: 'accounts' }).success,
        `'${type}' should be a declarable param type`,
      ).toBe(true);
    }
    for (const type of ['reference', 'owner', 'zzz_not_a_field_type']) {
      expect(
        ActionParamSchema.safeParse({ name: 'p', label: 'P', type, reference: 'accounts' }).success,
        `'${type}' should NOT be a declarable param type`,
      ).toBe(false);
    }
  });

  it('but a param ALREADY authored with it still gets its picker config', () => {
    // The legacy dialect `PARAM_TYPE_ALIASES` keeps (`reference` → `lookup`).
    // Dropping this face's `reference` branch outright would have silently
    // degraded such a param to a text input — which is why the convergence
    // asks the shared set over the FOLDED widget key rather than the raw
    // spelling. That fold lives in one place; this pins that it is consulted.
    const out = resolveOne({ field: 'account', type: 'reference' });
    expect(out.type).toBe('reference');
    expect(out.referenceTo).toBe('accounts');
    expect(out.displayField).toBe('name');
  });
});
