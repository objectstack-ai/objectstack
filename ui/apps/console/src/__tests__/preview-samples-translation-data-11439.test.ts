/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The `translation` preview sample's `data` is a valid `TranslationData`
 * bundle, and it files the bound `action` sample's copy where the spec reads
 * it (objectui#11439).
 *
 * `preview-samples-spec-valid.test.ts` keeps the `translation` sample in
 * `KNOWN_STALE` for a different question (the sample is the metadata-RECORD
 * form, not the `translations` collection's shape), and a quarantined sample
 * gets no generic signal there — so the bundle INSIDE the record is pinned
 * here. Before objectui#11439 it carried two shapes the spec refuses: a bare
 * string as a field's entry (`fields.amount`; the field node is `{ label }`)
 * and the bound `close_order`'s copy as a bare string under `globalActions`,
 * which is only for actions bound to no object.
 */

import { describe, it, expect } from 'vitest';
import { TranslationDataSchema } from '@objectstack/spec/system';
import { SAMPLES } from '../preview-samples';

type Bundle = {
  globalActions?: Record<string, unknown>;
  objects?: Record<string, { _actions?: Record<string, { label?: unknown }> }>;
};

describe('translation preview sample (objectui#11439)', () => {
  it('its `data` parses as TranslationData', () => {
    const parsed = TranslationDataSchema.safeParse(SAMPLES.translation.data);
    const issues = parsed.success
      ? []
      : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`);
    expect(issues).toEqual([]);
  });

  it('files the bound `action` sample\'s copy under its object, never under globalActions', () => {
    const action = SAMPLES.action as { name: string; objectName?: string };
    const data = SAMPLES.translation.data as Bundle;
    // Control: the action sample IS bound, so this question applies to it.
    expect(typeof action.objectName).toBe('string');
    expect(data.globalActions?.[action.name]).toBeUndefined();
    expect(typeof data.objects?.[action.objectName as string]?._actions?.[action.name]?.label).toBe(
      'string',
    );
  });
});
