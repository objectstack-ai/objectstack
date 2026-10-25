/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * resolveActionParams — regression coverage for `visible`-predicate propagation.
 *
 * The create-user phone bug (framework #2871 + objectui #2406) hid the
 * `phoneNumber` param via `visible: 'features.phoneNumber == true'`, but the
 * resolver dropped `visible` on the way to `ActionParamDialog`, so the field
 * kept rendering. These tests lock in that the predicate survives resolution —
 * in both the raw-string and the spec-normalised `{ dialect, source }` envelope
 * forms, and across inline / field-backed / missing-field branches.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveVisibleOptions, type ActionParamOption } from '@object-ui/core';
import type { ActionParam } from '@object-ui/types';
import {
  RESOLVED_ONLY_PARAM_KEYS,
  resolveActionParams,
  type ResolveActionParamsContext,
  type RawActionParam,
} from '@object-ui/fields';
import { paramToField } from './paramToField';

const ctx = (over: Partial<ResolveActionParamsContext> = {}): ResolveActionParamsContext => ({
  objectName: 'sys_user',
  objects: [
    { name: 'sys_user', fields: { phone_number: { type: 'text', label: 'Phone' } } },
  ],
  fieldLabel: (_o, _f, fallback) => fallback,
  ...over,
});

describe('resolveActionParams — visible propagation', () => {
  it('propagates a raw-string visible on an inline param', () => {
    const params: RawActionParam[] = [{ name: 'phoneNumber', visible: 'features.phoneNumber == true' }];
    expect(resolveActionParams(params, ctx())[0].visible).toBe('features.phoneNumber == true');
  });

  it('unwraps the { dialect, source } envelope the spec serialises to', () => {
    const params: RawActionParam[] = [
      { name: 'phoneNumber', visible: { dialect: 'cel', source: 'features.phoneNumber == true' } },
    ];
    expect(resolveActionParams(params, ctx())[0].visible).toBe('features.phoneNumber == true');
  });

  it('propagates visible on a field-backed param', () => {
    const params: RawActionParam[] = [{ field: 'phone_number', visible: 'features.phoneNumber == true' }];
    expect(resolveActionParams(params, ctx())[0].visible).toBe('features.phoneNumber == true');
  });

  it('propagates visible on the missing-field fallback branch', () => {
    const params: RawActionParam[] = [{ field: 'does_not_exist', visible: 'features.phoneNumber == true' }];
    // No such field on the object → text-input fallback, but visible still survives.
    expect(resolveActionParams(params, ctx())[0].visible).toBe('features.phoneNumber == true');
  });

  it('leaves visible undefined when the param has no predicate', () => {
    const params: RawActionParam[] = [{ name: 'email' }];
    expect(resolveActionParams(params, ctx())[0].visible).toBeUndefined();
  });

  it('treats an empty predicate as absent (always visible)', () => {
    const params: RawActionParam[] = [
      { name: 'a', visible: '' },
      { name: 'b', visible: { dialect: 'cel', source: '' } },
    ];
    const out = resolveActionParams(params, ctx());
    expect(out[0].visible).toBeUndefined();
    expect(out[1].visible).toBeUndefined();
  });
});

describe('resolveActionParams — widget config (ADR-0059)', () => {
  const fileCtx = () =>
    ctx({
      objects: [
        {
          name: 'sys_user',
          fields: {
            avatar_file: {
              type: 'file',
              label: 'Avatar',
              multiple: true,
              accept: ['image/*'],
              maxSize: 1024,
            },
            phone_number: { type: 'text', label: 'Phone' },
          },
        },
      ],
    });

  it('carries multiple/accept/maxSize on an inline param', () => {
    const params: RawActionParam[] = [
      { name: 'attachments', type: 'file', multiple: true, accept: ['application/pdf'], maxSize: 2048 },
    ];
    expect(resolveActionParams(params, ctx())[0]).toMatchObject({
      type: 'file',
      multiple: true,
      accept: ['application/pdf'],
      maxSize: 2048,
    });
  });

  it('inherits multiple/accept/maxSize from the referenced field (any type, not just lookup)', () => {
    const params: RawActionParam[] = [{ field: 'avatar_file' }];
    expect(resolveActionParams(params, fileCtx())[0]).toMatchObject({
      type: 'file',
      multiple: true,
      accept: ['image/*'],
      maxSize: 1024,
    });
  });

  it('inline overrides win over the field metadata', () => {
    const params: RawActionParam[] = [{ field: 'avatar_file', multiple: false, maxSize: 4096 }];
    expect(resolveActionParams(params, fileCtx())[0]).toMatchObject({
      multiple: false,
      accept: ['image/*'],
      maxSize: 4096,
    });
  });

  it('carries multiple/accept/maxSize on the missing-field fallback branch', () => {
    const params: RawActionParam[] = [
      { field: 'does_not_exist', type: 'file', multiple: true, accept: ['.csv'], maxSize: 99 },
    ];
    expect(resolveActionParams(params, ctx())[0]).toMatchObject({
      multiple: true,
      accept: ['.csv'],
      maxSize: 99,
    });
  });
});

/**
 * #3405 — an inline `lookup` param carries its own picker target.
 *
 * Real-world break (PLAT-DEF-005): a QC dispatch action declared
 * `{ name: 'inspector', type: 'lookup', reference: 'sys_user' }`. The key was
 * unknown to both the spec schema and this resolver, so it was dropped twice
 * over and `paramToField()` degraded the param to a "paste the record id
 * (UUID)" text box — a supervisor had to go find a user's UUID by hand.
 */
describe('resolveActionParams — inline lookup reference target (#3405)', () => {
  const lookupCtx = () =>
    ctx({
      objects: [
        {
          name: 'quality_dispatch',
          fields: {
            inspector: { type: 'lookup', label: '质检人', reference: 'sys_user' },
            reviewer: { type: 'lookup', label: 'Reviewer', reference: 'sys_user', displayField: 'name' },
          },
        },
      ],
      objectName: 'quality_dispatch',
    });

  it('maps an inline `reference` onto referenceTo so the picker can query', () => {
    const params: RawActionParam[] = [
      { name: 'inspector', label: '质检员', type: 'lookup', reference: 'sys_user', required: true },
    ];
    expect(resolveActionParams(params, lookupCtx())[0]).toMatchObject({
      name: 'inspector',
      type: 'lookup',
      referenceTo: 'sys_user',
    });
  });

  it('still inherits the target from the referenced field when field-backed', () => {
    expect(resolveActionParams([{ field: 'inspector' }], lookupCtx())[0]).toMatchObject({
      type: 'lookup',
      referenceTo: 'sys_user',
    });
    expect(resolveActionParams([{ field: 'reviewer' }], lookupCtx())[0]).toMatchObject({
      referenceTo: 'sys_user',
      displayField: 'name',
    });
  });

  it('lets an inline reference override the field metadata', () => {
    const params: RawActionParam[] = [{ field: 'inspector', reference: 'sys_member' }];
    expect(resolveActionParams(params, lookupCtx())[0].referenceTo).toBe('sys_member');
  });

  it('keeps the inline reference on the missing-field fallback branch', () => {
    const params: RawActionParam[] = [
      { field: 'does_not_exist', type: 'lookup', reference: 'sys_user' },
    ];
    expect(resolveActionParams(params, lookupCtx())[0].referenceTo).toBe('sys_user');
  });

  it('leaves referenceTo undefined for a non-picker inline param', () => {
    expect(resolveActionParams([{ name: 'note', type: 'textarea' }], lookupCtx())[0].referenceTo).toBeUndefined();
  });
});

/**
 * objectui#3174 — the gate the previous suite could not be.
 *
 * Every test above authors a `RawActionParam`, this file's own local input
 * interface. That is exactly why the defect survived: the resolver agreed with
 * itself, while `@object-ui/types`' public `ActionParam` — the type a host app
 * actually writes against — declared `referenceTo` and (before objectui#3156)
 * not `reference`. An author who followed the published type got a param whose
 * picker target was dropped here and a dev warning downstream naming a key the
 * type did not have.
 *
 * So these tests author through the PUBLIC type and follow one param all the
 * way to the field the widgets consume: `ActionParam` → `resolveActionParams()`
 * → `ActionParamDef` → `paramToField()` → `reference`. The internal pipeline
 * keeps its two spellings (authoring `reference`, resolved `referenceTo`) — the
 * point is not that they match, it is that the public entry and the public exit
 * do (the exit was `reference_to` until objectui#11070 round 4).
 */
describe('resolveActionParams — authored through the public ActionParam type (objectui#3174)', () => {
  const authoringCtx = () =>
    ctx({
      objectName: 'quality_dispatch',
      objects: [
        {
          name: 'quality_dispatch',
          fields: {
            inspector: {
              type: 'lookup',
              label: 'Inspector',
              reference: 'sys_user',
              displayField: 'name',
              id_field: 'id',
            },
          },
        },
      ],
    });

  /** Public authoring shape → the field object `ActionParamDialog` renders. */
  const authorToField = (authored: ActionParam) =>
    paramToField(resolveActionParams([authored], authoringCtx())[0]);

  it('an inline `reference` reaches the picker as `reference`', () => {
    const authored: ActionParam = {
      name: 'account_id',
      label: 'Account',
      type: 'lookup',
      reference: 'account',
    };
    expect(authorToField(authored)).toMatchObject({
      name: 'account_id',
      type: 'lookup',
      reference: 'account',
    });
  });

  it('a field-backed param inherits the whole picker group', () => {
    const authored: ActionParam = { field: 'inspector' };
    expect(authorToField(authored)).toMatchObject({
      type: 'lookup',
      reference: 'sys_user',
      // objectui#7155 — the spec spelling, emitted by `paramToField`.
      displayField: 'name',
      idField: 'id',
    });
  });

  it('`master_detail` reaches the picker too — both LOOKUP_WIDGET_TYPES', () => {
    const authored: ActionParam = { name: 'parent_id', type: 'master_detail', reference: 'account' };
    expect(authorToField(authored)).toMatchObject({
      type: 'master_detail',
      reference: 'account',
    });
  });

  it('never silently degrades: no dev warning on the authorable spelling', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const authored: ActionParam = { name: 'account_id', type: 'lookup', reference: 'account' };
      authorToField(authored);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('names `referenceTo` at the resolver instead of dropping it silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // The exact shape objectui#3174 reported. `tsc` rejects it against the
      // public type now (pinned in @object-ui/types'
      // `page-nav-misc-spec-parity.test.ts`); this covers the JS / JSON /
      // synthesised paths `tsc` does not gate. It stays REFUSED, not resolved:
      // `ActionParamSchema` is `.strict()`, so honouring it here would render a
      // picker for metadata the server will not store.
      const offSpec = { name: 'account_id', type: 'lookup', referenceTo: 'account' };
      const field = authorToField(offSpec as unknown as ActionParam);

      const messages = warn.mock.calls.map((c) => String(c[0]));
      const named = messages.filter((m) => m.includes('`referenceTo`'));
      expect(named).toHaveLength(1);
      expect(named[0]).toContain('account_id');
      expect(named[0]).toContain('Use `reference` instead');

      // Still degrades — the metadata is genuinely unusable — but loudly, and
      // the downstream warning now prescribes a key the author can write.
      expect(field.reference).toBeUndefined();
      expect(field.type).toBe('text');
      expect(messages.some((m) => m.includes('degrades to a plain record-id text input'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('names every resolved-only key an author may reach for', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const key of Object.keys(RESOLVED_ONLY_PARAM_KEYS)) {
        warn.mockClear();
        resolveActionParams([{ name: 'p', [key]: 'x' } as RawActionParam], authoringCtx());
        const named = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(`\`${key}\``));
        expect(named, `expected a dev warning naming \`${key}\``).toHaveLength(1);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it('says nothing for a param that only uses authorable keys', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const authored: ActionParam = {
        name: 'comment',
        label: 'Comment',
        type: 'textarea',
        required: true,
        placeholder: 'Why?',
        helpText: 'Shown to the approver',
        defaultFromRow: true,
        visible: 'features.phoneNumber',
      };
      resolveActionParams([authored], authoringCtx());
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('the public authoring type is accepted by this resolver (type-level)', () => {
    // The structural half of the fix: whatever `@object-ui/types` says an
    // author may write has to be readable here. `RawActionParam` is a local
    // restatement, and the two drifting apart is objectui#3174's mechanism —
    // this assignment is what fails when they do.
    const authored: ActionParam = { name: 'account_id', type: 'lookup', reference: 'account' };
    const raw: RawActionParam = authored;
    expect(raw.reference).toBe('account');
  });
});

/**
 * objectui#3559 — a field-inherited option list keeps the keys the FIELD declared.
 *
 * `normaliseOptions()` rebuilt every inherited entry as a fresh `{ label, value }`,
 * so a select field's per-option `visibleWhen` (ADR-0058 / #2284, declared by
 * `@objectstack/spec`'s `SelectOptionSchema` and filtered by
 * `resolveVisibleOptions()` in `@object-ui/core`) survived in the object form and
 * vanished the moment an action param inherited the field via `{ field: '…' }`.
 * The dialog then offered the whole list — predicate-hidden entries included —
 * with no diagnostic on either side. `color` / `icon` / `disabled` went the same
 * way.
 *
 * The asymmetry is the tell: options authored INLINE on the param never came
 * through `normaliseOptions()` at all (`param.options ?? normaliseOptions(…)`),
 * so they always sank verbatim. One branch of one `??` behaved one way and the
 * other the other, for the same authored key.
 *
 * These tests follow the resolver's two jobs (expand bare strings, translate the
 * label) and pin that it does no third one, then carry one inherited list all the
 * way to `resolveVisibleOptions()` — the reader the option widgets wrap — so the
 * claim under test is the observable one: the predicate narrows the dialog's list.
 */
describe('resolveActionParams — field-inherited option keys (objectui#3559)', () => {
  /**
   * A `select` field whose options carry the full declared vocabulary. Authoring
   * this literal is itself the type-level half of the fix: this file is compiled
   * by `tsconfig.test.json`, so a `RuntimeField.options` re-narrowed to
   * `{ label, value }` fails excess-property checking right here rather than
   * silently reverting the behaviour below.
   */
  const optionCtx = () =>
    ctx({
      objectName: 'account',
      objects: [
        {
          name: 'account',
          fields: {
            tier: {
              type: 'select',
              label: 'Tier',
              options: [
                { label: 'Standard', value: 'standard', color: 'gray' },
                {
                  label: 'Admin only',
                  value: 'admin_only',
                  visibleWhen: "'admin' in current_user.positions",
                  color: 'red',
                  icon: 'shield',
                  disabled: false,
                },
              ],
            },
            stage: { type: 'select', label: 'Stage', options: ['open', 'won'] },
          },
        },
      ],
    });

  it('keeps a per-option visibleWhen the field declared', () => {
    const resolved = resolveActionParams([{ field: 'tier' }], optionCtx())[0];
    expect(resolved.options).toEqual([
      { label: 'Standard', value: 'standard', color: 'gray' },
      {
        label: 'Admin only',
        value: 'admin_only',
        visibleWhen: "'admin' in current_user.positions",
        color: 'red',
        icon: 'shield',
        disabled: false,
      },
    ]);
  });

  it('still translates the label through fieldOptionLabel, keeping the other keys', () => {
    const resolved = resolveActionParams(
      [{ field: 'tier' }],
      ctx({
        ...optionCtx(),
        fieldOptionLabel: (objectName, fieldName, value, fallback) =>
          `${objectName}.${fieldName}.${value}:${fallback}`,
      }),
    )[0];
    expect(resolved.options?.[1]).toEqual({
      label: 'account.tier.admin_only:Admin only',
      value: 'admin_only',
      visibleWhen: "'admin' in current_user.positions",
      color: 'red',
      icon: 'shield',
      disabled: false,
    });
  });

  it('still expands bare strings into label/value pairs', () => {
    expect(resolveActionParams([{ field: 'stage' }], optionCtx())[0].options).toEqual([
      { label: 'open', value: 'open' },
      { label: 'won', value: 'won' },
    ]);
  });

  it('leaves options undefined when the field declares none', () => {
    const resolved = resolveActionParams(
      [{ field: 'tier' }],
      ctx({ objectName: 'account', objects: [{ name: 'account', fields: { tier: { type: 'text' } } }] }),
    )[0];
    expect(resolved.options).toBeUndefined();
  });

  it('passes an option list authored INLINE on the param through verbatim', () => {
    // The branch that was never broken — pinned so the fix is read as making the
    // two branches agree, not as touching this one. Stays green either way.
    const inline = [
      { label: 'Yes', value: 'yes' },
      { label: 'Admin only', value: 'admin_only', visibleWhen: "'admin' in current_user.positions" },
    ];
    const resolved = resolveActionParams(
      [{ field: 'tier', options: inline }, { name: 'confirm', type: 'select', options: inline }],
      optionCtx(),
    );
    // Field-backed with inline options: the inline list wins and the field's is
    // not consulted (same object identity — nothing rebuilt it).
    expect(resolved[0].options).toBe(inline);
    expect(resolved[1].options).toBe(inline);
  });

  it('reaches resolveVisibleOptions through paramToField and narrows the offered set', () => {
    // End to end over the real chain the dialog uses: field metadata →
    // resolveActionParams → paramToField → the `field.options` a widget reads →
    // `resolveVisibleOptions`, which is what `useCascadingOptions` wraps.
    const field = paramToField(resolveActionParams([{ field: 'tier' }], optionCtx())[0]);

    const forSales = resolveVisibleOptions(field.options, {}, { current_user: { positions: ['sales'] } });
    expect(forSales.map((o) => o.value)).toEqual(['standard']);

    const forAdmin = resolveVisibleOptions(field.options, {}, { current_user: { positions: ['admin'] } });
    expect(forAdmin.map((o) => o.value)).toEqual(['standard', 'admin_only']);
  });

  it('keeps `label` and `value` required on a param option (type-level)', () => {
    // The catch-all widens the vocabulary; it must not dissolve the two keys
    // this layer itself reads. Compiled by `tsconfig.test.json`, so these
    // assertions are checked — a re-widening to `Record< string, unknown >`
    // turns the unused suppressions into errors.
    const complete: ActionParamOption = { label: 'Standard', value: 'standard', color: 'gray' };
    expect(complete.value).toBe('standard');

    // @ts-expect-error `value` is not optional
    const noValue: ActionParamOption = { label: 'Standard' };
    // @ts-expect-error `label` is not optional
    const noLabel: ActionParamOption = { value: 'standard' };
    expect([noValue, noLabel]).toHaveLength(2);
  });
});
