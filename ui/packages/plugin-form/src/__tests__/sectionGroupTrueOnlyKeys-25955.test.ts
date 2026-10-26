/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25955 — the group-owned-key warning agrees with the spec on what
 * "declares" means.
 *
 * `FormSectionSchema` gives `collapsible` and `collapsed` a `.default(false)`,
 * so a PARSED `{ group, columns }` section always carries both as `false`, and
 * the spec's group refinement lists them under `trueOnlyDerivedKeys`: only
 * `true` is refused beside `group`. The renderer used to report any value that
 * was not `undefined`, so every group section of every parsed form logged
 * "also declares `collapsible`, `collapsed`" and prescribed moving keys its
 * author never wrote.
 *
 * The discriminating legs are the PARSED ones: they feed the renderer the
 * spec's own output, never a hand-written literal that merely looks parsed.
 * The per-key agreement leg then measures the spec's refusal of each
 * group-owned key at `false` and at `true` and requires the warning to match
 * it key for key, because the spec passes its true-only list inline and
 * exports no name a second copy could be read from.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormSectionSchema } from '@objectstack/spec/ui';
import {
  GROUP_OWNED_SECTION_KEYS,
  resetSectionGroupReports,
  resolveSectionGroupReferences,
} from '../sectionGroups';

const OBJECT = {
  name: 'contact',
  fieldGroups: [{ key: 'buying_centre', label: 'Buying Centre' }],
  fields: {
    role: { type: 'text', label: 'Role', group: 'buying_centre' },
    influence: { type: 'text', label: 'Influence', group: 'buying_centre' },
  },
};

/** Run one section through the resolver; return the `[object-ui]` warnings it logged. */
function warningsFor(section: Record<string, unknown>): string[] {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    resolveSectionGroupReferences([section as any], {
      objectName: 'contact',
      formType: 'simple',
      objectDef: OBJECT,
    });
    return warn.mock.calls
      .map((args) => String(args[0]))
      .filter((m) => m.startsWith('[object-ui]'));
  } finally {
    warn.mockRestore();
  }
}

/** The keys a warning names as restated, in its own backtick spelling. */
function restatedIn(warning: string): string[] {
  const head = warning.slice(0, warning.indexOf(' — the group owns'));
  return [...head.matchAll(/`([a-zA-Z]+)`/g)].map((m) => m[1]);
}

describe('objectstack#25955 — group-owned-key warning, true-only keys', () => {
  beforeEach(() => resetSectionGroupReports());
  afterEach(() => resetSectionGroupReports());

  it('PARSED_GROUP_SECTION_IS_SILENT — the spec-filled `false` defaults are not a restatement', () => {
    const parsed = FormSectionSchema.parse({ group: 'buying_centre', columns: 2 });
    // Premise of the card, measured: the parse fills both keys.
    expect(parsed).toMatchObject({ collapsible: false, collapsed: false });
    expect(warningsFor(parsed)).toEqual([]);
  });

  it('PARSED_EXPLICIT_FALSE_IS_SILENT — an authored `false` parses and declares what the group delivers', () => {
    const parsed = FormSectionSchema.parse({ group: 'buying_centre', collapsible: false, collapsed: false });
    expect(warningsFor(parsed)).toEqual([]);
  });

  it('PROGRAMMATIC_TRUE_STILL_WARNS — the case the warning exists for', () => {
    const warns = warningsFor({ group: 'buying_centre', collapsed: true });
    expect(warns).toHaveLength(1);
    expect(restatedIn(warns[0])).toEqual(['collapsed']);
  });

  it('TRUE_BESIDE_A_PARSED_FALSE_NAMES_ONLY_THE_TRUE_KEY', () => {
    const warns = warningsFor({ group: 'buying_centre', collapsible: true, collapsed: false });
    expect(warns).toHaveLength(1);
    expect(restatedIn(warns[0])).toEqual(['collapsible']);
  });

  it('NON_TRUE_ONLY_KEYS_STILL_WARN_ON_ANY_VALUE — the split did not narrow the rest', () => {
    const warns = warningsFor({ group: 'buying_centre', label: 'Mine', collapsible: false });
    expect(warns).toHaveLength(1);
    expect(restatedIn(warns[0])).toEqual(['label']);
  });

  it('WARNING_AGREES_WITH_THE_SPEC_KEY_BY_KEY — refused at parse iff reported', () => {
    for (const key of GROUP_OWNED_SECTION_KEYS) {
      const boolish = key === 'collapsible' || key === 'collapsed';
      const values: unknown[] = boolish ? [false, true] : ['v'];
      for (const value of values) {
        const section = { group: 'buying_centre', [key]: value };
        const r = FormSectionSchema.safeParse(section);
        const refusedAtKey =
          !r.success && r.error.issues.some((i) => i.code === 'custom' && i.path.join('.') === key);
        resetSectionGroupReports();
        const reported = warningsFor(section).flatMap(restatedIn).includes(key);
        expect({ key, value, reported }).toEqual({ key, value, reported: refusedAtKey });
      }
    }
  });
});
