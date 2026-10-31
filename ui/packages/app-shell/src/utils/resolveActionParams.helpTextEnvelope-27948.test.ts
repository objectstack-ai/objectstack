/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27948 (ruling A, step 2) — a param's `helpText` is a `template`
 * slot, so the spec's authoring type (and a served param) can carry
 * `{ dialect: 'template', source }` where it carried a string. `RawActionParam`
 * said `string`, so the public authoring type stopped being assignable to it
 * (the `Type Check UI` red), and an envelope carried through untouched would
 * reach `ActionParamDialog` as an object. The resolver emits the text.
 */
import { describe, it, expect } from 'vitest';
import type { ActionParam } from '@object-ui/types';
import { resolveActionParams, type ResolveActionParamsContext, type RawActionParam } from '@object-ui/fields';

const ctx = (): ResolveActionParamsContext => ({
  objectName: 'crm_account',
  objects: [{ name: 'crm_account', fields: { reason: { type: 'text', label: 'Reason', description: 'The field help' } } }],
  fieldLabel: (_o, _f, fallback) => fallback,
});

const HINT = 'Why {{ record.name }} is paused';
const envelope = { dialect: 'template' as const, source: HINT };

describe('resolveActionParams reads a template-envelope helpText (objectstack#27948)', () => {
  it('the public authoring type is assignable, envelope included', () => {
    const authored: ActionParam = { name: 'reason', type: 'text', helpText: envelope };
    const raw: RawActionParam = authored;
    expect(raw.helpText).toBe(envelope);
  });

  it('an inline param emits the envelope\'s text, exactly as the bare string', () => {
    const [fromEnvelope] = resolveActionParams([{ name: 'reason', type: 'text', helpText: envelope }], ctx());
    const [fromString] = resolveActionParams([{ name: 'reason', type: 'text', helpText: HINT }], ctx());
    expect(fromEnvelope.helpText).toBe(HINT);
    expect(fromEnvelope).toEqual(fromString);
  });

  it('a field-backed param emits the envelope\'s text; one with no source falls back to the field\'s help', () => {
    expect(resolveActionParams([{ field: 'reason', helpText: envelope }], ctx())[0].helpText).toBe(HINT);
    expect(resolveActionParams([{ field: 'reason', helpText: { dialect: 'template' } }], ctx())[0].helpText)
      .toBe(resolveActionParams([{ field: 'reason' }], ctx())[0].helpText);
  });
});
