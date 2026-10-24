// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio inspector offers `element:text` the published `variant` nine
 * (objectui#7450, ruling B of 2026-09-07).
 *
 * The inspector's `variant` select is an OFFER and nothing else: what it writes
 * is judged by the contract at save, and a stored value it does not list still
 * shows, flagged, in `InspectorSelectField`. So it offers exactly the nine
 * values `ui:text` publishes (`TextSchema.variant` in the `@object-ui/types`
 * Zod mirror), each one a value the installed `@objectstack/spec` accepts on
 * `element:text`, and it no longer offers `heading` / `subheading`: the ruling
 * retired that pair, and `@objectstack/spec` 17.7.0 refuses it (objectui#11717),
 * so the designer does not write it.
 *
 * Whether each label key exists in both locale tables, and is the key its
 * position implies, is `block-config-i18n.test.ts`'s question. This file asks
 * the vocabulary question.
 */

import { describe, it, expect } from 'vitest';
import { ElementTextPropsSchema } from '@objectstack/spec/ui';
import { shapeEnumOptions } from '@object-ui/test-support';
import { TextSchema } from '@object-ui/types/zod';
import { BLOCK_CONFIG } from '../block-config';
import { t } from '../../i18n';

const PUBLISHED = shapeEnumOptions(TextSchema, 'variant');
const CONTRACT = shapeEnumOptions(ElementTextPropsSchema, 'variant');

const variantField = () => BLOCK_CONFIG['element:text']?.find((field) => field.name === 'variant');
const variantOptions = (): Array<{ value: string; label: string }> => {
  const field = variantField();
  return field?.kind === 'select' ? field.options : [];
};
const offered = () => variantOptions().map((option) => option.value);

describe('objectui#7450 — the element:text variant select offers the published nine', () => {
  it('reads both vocabularies (anti-vacuity)', () => {
    expect(PUBLISHED).toHaveLength(9);
    expect(CONTRACT.length).toBeGreaterThanOrEqual(PUBLISHED.length);
    expect(variantField()?.kind).toBe('select');
  });

  it('offers the nine, in the order ui:text publishes them', () => {
    expect(offered()).toEqual(PUBLISHED);
  });

  it.each(PUBLISHED)('offers %s, a value the installed contract accepts on element:text', (variant) => {
    expect(ElementTextPropsSchema.safeParse({ content: 'Quick links', variant }).success).toBe(true);
  });

  it('offers nothing the contract accepts only as a pre-convergence spelling', () => {
    const preConvergence = CONTRACT.filter((value) => !PUBLISHED.includes(value));
    for (const value of preConvergence) expect(offered()).not.toContain(value);
  });

  it.each(['en-US', 'zh-CN'])('labels the nine distinctly in %s', (locale) => {
    const options = variantOptions();
    const labels = options.map((option) => t(option.label, locale));
    expect(new Set(labels).size).toBe(PUBLISHED.length);
    // `t` echoes an unknown key back, so a label equal to its key is a missing row.
    for (const [index, label] of labels.entries()) {
      expect(label, `option ${options[index]?.value} has no ${locale} label`).not.toBe(options[index]?.label);
    }
  });
});
