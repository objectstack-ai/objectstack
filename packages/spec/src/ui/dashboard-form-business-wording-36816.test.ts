// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #36816 — the dashboard settings panel's hints are written for the person
 * building the dashboard, not for a developer.
 *
 * The console renders `dashboardForm` from the bundled spec, and an English
 * console shows each row's `helpText` exactly as written here (there is no
 * `en` overlay). Before this card nine of those hints spoke developer
 * vocabulary: a casing convention ("snake_case unique identifier"), a CSS
 * length ("in steps of 0.25rem (4 = 1rem)"), and "config".
 *
 * What is pinned is the KIND of text, never a sentence: each rewritten row
 * still declares a hint, and no hint anywhere in the form reaches for that
 * vocabulary. The control proves the vocabulary test can fire, against the
 * hints as they read before the rewrite.
 */

import { describe, it, expect } from 'vitest';

import { dashboardForm } from './dashboard.form';

type FormField = { field?: string; helpText?: string; fields?: FormField[] };

/** Developer vocabulary a dashboard builder cannot act on. */
const DEVELOPER_VOCABULARY = /tailwind|\d\s*(?:rem|px|em)\b|snake_case|camel_?case|kebab-case|\bconfig\b/i;

/** The rows this card rewrote, by dot path from the form root. */
const REWRITTEN_ROWS = [
  'name',
  'label',
  'columns',
  'gap',
  'refreshIntervalSeconds',
  'header',
  'widgets',
  'dateRange',
  'globalFilters',
] as const;

/** The hints those rows carried before, the control's population. */
const PRE_REWRITE_HINTS = [
  'snake_case unique identifier',
  'Space between widgets, in steps of 0.25rem (4 = 1rem)',
  'Dashboard header config (title, subtitle, actions)',
];

/** Every declared field of the form with its dot path, nested rows included. */
function allFields(): Array<{ path: string; field: FormField }> {
  const out: Array<{ path: string; field: FormField }> = [];
  const walk = (fields: FormField[] | undefined, prefix: string) => {
    for (const f of fields ?? []) {
      if (!f?.field) continue;
      const path = prefix ? `${prefix}.${f.field}` : f.field;
      out.push({ path, field: f });
      walk(f.fields, path);
    }
  };
  for (const section of (dashboardForm.sections ?? []) as Array<{ fields?: FormField[] }>) {
    walk(section.fields, '');
  }
  return out;
}

function row(path: string): FormField {
  const hit = allFields().find((f) => f.path === path);
  if (!hit) throw new Error(`dashboardForm declares no row \`${path}\``);
  return hit.field;
}

describe('#36816 — dashboard settings hints read in business terms', () => {
  it('control: the vocabulary test fires on the hints as they read before', () => {
    for (const hint of PRE_REWRITE_HINTS) {
      expect(hint, hint).toMatch(DEVELOPER_VOCABULARY);
    }
  });

  for (const path of REWRITTEN_ROWS) {
    it(`\`${path}\` declares a hint free of developer vocabulary`, () => {
      const hint = row(path).helpText;
      expect(typeof hint, `${path}.helpText`).toBe('string');
      expect(hint!.trim().length, `${path}.helpText is empty`).toBeGreaterThan(0);
      expect(hint).not.toMatch(DEVELOPER_VOCABULARY);
    });
  }

  it('no hint anywhere in the form uses developer vocabulary', () => {
    const hinted = allFields().filter(({ field }) => typeof field.helpText === 'string');
    // Non-vacuity: the sweep sees at least the rows rewritten here.
    expect(hinted.length).toBeGreaterThanOrEqual(REWRITTEN_ROWS.length);
    const offenders = hinted
      .filter(({ field }) => DEVELOPER_VOCABULARY.test(field.helpText!))
      .map(({ path, field }) => `${path}: ${field.helpText}`);
    expect(offenders).toEqual([]);
  });
});
