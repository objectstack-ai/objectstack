/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8641 — what `sectionGroups.ts` publishes from the package ENTRY,
 * and what it deliberately does not.
 *
 * The card is a surface decision (its arm A), so the surface is what this
 * pins, in the shape objectui#6059 established for the same barrel: the
 * positive half is proved by anything that imports the name — `apps/console`'s
 * `FormPage` does, and its suite reds without it — while the NEGATIVE half is
 * what nothing else would notice. `sectionGroups.ts` holds four more names,
 * and `export * from './sectionGroups'` would have published every one of them
 * in a diff that reads tidier than the explicit list.
 *
 * Each withheld name has its own reason, not "nobody asked":
 *
 *   hasSectionGroupReference   the resolver already answers it — it returns its
 *                              input array UNCHANGED when no section uses the
 *                              reference form, so a consumer needs no separate
 *                              predicate to avoid perturbing an existing form.
 *                              Publishing both would invite a caller to gate on
 *                              one and resolve with the other, which is two
 *                              readers of one question.
 *   resetSectionGroupReports   this package's own test seam for the once-per-key
 *                              diagnostic set. Published, it becomes a supported
 *                              way to re-fire warnings.
 *   GROUP_OWNED_SECTION_KEYS   both are `@objectstack/spec`'s facts about what
 *   SECTION_LAYOUT_KEYS        `FormSectionSchema` refuses and permits beside
 *                              `group`. This module reads them to REPORT; a
 *                              consumer wanting the rule wants the spec, and a
 *                              second published spelling of one contract is
 *                              exactly what the reference form exists to avoid.
 */

import { describe, expect, it } from 'vitest';
import * as entry from '../index';
import * as sectionGroups from '../sectionGroups';

/** Published by the entry as of #8641 — the resolver, and only the resolver. */
const PUBLISHED = ['resolveSectionGroupReferences'] as const;

/** Present in `sectionGroups.ts` and deliberately NOT on the entry. */
const WITHHELD = [
  'hasSectionGroupReference',
  'resetSectionGroupReports',
  'GROUP_OWNED_SECTION_KEYS',
  'SECTION_LAYOUT_KEYS',
] as const;

describe('@object-ui/plugin-form entry — the #8641 surface addition', () => {
  it('publishes the resolver, as the very function `sectionGroups` defines', () => {
    for (const name of PUBLISHED) {
      expect(typeof (entry as Record<string, unknown>)[name]).toBe('function');
      // Identity, not just presence: a re-export must not quietly become a
      // second implementation free to disagree with the one this package's own
      // `ObjectForm` calls. "One assembler, one behaviour" is the whole reason
      // the console imports this instead of deriving sections itself.
      expect((entry as Record<string, unknown>)[name]).toBe(
        (sectionGroups as Record<string, unknown>)[name],
      );
    }
  });

  it('withholds the rest of the module', () => {
    for (const name of WITHHELD) {
      // Defined next door, so the assertion is about the ENTRY and not about a
      // name that does not exist anywhere.
      expect((sectionGroups as Record<string, unknown>)[name]).toBeDefined();
      expect(entry as Record<string, unknown>).not.toHaveProperty(name);
    }
  });
});
