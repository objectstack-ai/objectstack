// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The classifier and the section spellings behind the view inspector's
 * required-field-in-gated-section refusal (objectui#6900).
 *
 * The rows are the card's step-1 table: a section predicate is fenced only when
 * it reads a root the object's own field rules cannot restate — rows 7–11,
 * identity / feature / host / page state. Every other row draws nothing, and
 * each is pinned here so a later widening is a visible edit, not a drift.
 *
 * Roots are read by the REAL `@objectstack/formula` parser, the same export the
 * module loads lazily at runtime.
 */

import { describe, it, expect } from 'vitest';
import { collectCelRootIdentifiers } from '@objectstack/formula';
import {
  findRequiredInGatedSections,
  predicatesToRead,
  readFormSections,
  type CelRootReader,
} from './requiredInGatedSection';
import type { ObjectFieldInfo } from '../previews/useObjectFields';

const rootsOf: CelRootReader = (source) => {
  const res = collectCelRootIdentifiers(source);
  return res.ok ? res.roots : null;
};

const FIELDS: ObjectFieldInfo[] = [
  { name: 'subject', label: 'Subject', type: 'text', hidden: false },
  { name: 'salary', label: 'Salary', type: 'number', hidden: false, required: true },
  { name: 'bonus', label: 'Bonus', type: 'number', hidden: false, required: true },
];

const cel = (source: string) => ({ dialect: 'cel', source });

function issuesFor(body: Record<string, unknown>) {
  return findRequiredInGatedSections(readFormSections(body), FIELDS, rootsOf);
}

function gated(visibleWhen: unknown, fields: unknown[] = ['salary']) {
  return { sections: [{ name: 'pay', label: 'Compensation', visibleWhen, fields }] };
}

describe('requiredInGatedSection — the fenced rows (objectui#6900)', () => {
  it.each([
    ['row 7 current_user', "'sales_manager' in current_user.positions", ['current_user']],
    ['row 7 alias user', "user.role == 'admin'", ['user']],
    ['row 7 alias ctx.user', "ctx.user.id != ''", ['ctx']],
    ['row 7 alias os.user', "os.user.id != ''", ['os']],
    ['row 7 mixed with a record root', "record.status == 'sent' && 'hr' in current_user.positions", ['current_user']],
    ['row 8 features', 'features.multiOrgEnabled', ['features']],
    ['row 9 app', "app.locale == 'en'", ['app']],
    ['row 11 page', "page.selectedProjectId != ''", ['page']],
  ])('%s is refused', (_row, source, roots) => {
    const issues = issuesFor(gated(cel(source)));
    expect(issues).toEqual([
      {
        sectionIndex: 0,
        section: 'Compensation',
        predicate: source,
        roots,
        field: 'salary',
        fieldLabel: 'Salary',
      },
    ]);
  });
});

describe('requiredInGatedSection — rows that draw nothing (objectui#6900)', () => {
  it.each([
    ['row 1 record', "record.status == 'sent'"],
    ['row 2 has() macro', 'has(record.owner_id)'],
    ['row 3 previous', "previous.status == 'draft'"],
    ['row 4 constant', 'true'],
    ['row 5 bare shorthand', "status == 'sent'"],
    ['row 6 data as the row alias', "data.type == 'list'"],
    ['row 12 parent', 'parent.x == 1'],
    ['a predicate that does not parse', 'record.amount >'],
  ])('%s', (_row, source) => {
    expect(issuesFor(gated(cel(source)))).toEqual([]);
  });

  it('a blank predicate and a non-CEL dialect are not read', () => {
    expect(issuesFor(gated('   '))).toEqual([]);
    expect(issuesFor(gated({ dialect: 'template', source: 'current_user.x' }))).toEqual([]);
  });

  it('a section with no predicate draws nothing', () => {
    expect(issuesFor({ sections: [{ name: 'pay', fields: ['salary'] }] })).toEqual([]);
  });
});

describe('requiredInGatedSection — the section spellings (objectui#6900)', () => {
  const GATE = "'sales_manager' in current_user.positions";

  it('reads a bare-string predicate as well as the envelope', () => {
    expect(issuesFor(gated(GATE))).toHaveLength(1);
  });

  it('reads `{ field }` member entries as well as name strings', () => {
    expect(issuesFor(gated(cel(GATE), [{ field: 'salary', label: 'Pay' }, 'subject']))).toHaveLength(1);
  });

  it('reports each required member of a gated section once', () => {
    const issues = issuesFor(gated(cel(GATE), ['salary', 'bonus', 'subject', 'salary']));
    expect(issues.map((i) => i.field)).toEqual(['salary', 'bonus']);
  });

  it('reads the legacy `groups` alias when `sections` is absent', () => {
    const body = { groups: [{ label: 'Compensation', visibleWhen: cel(GATE), fields: ['salary'] }] };
    expect(issuesFor(body)).toHaveLength(1);
  });

  it('`sections` wins over `groups` when present — an empty array included', () => {
    const groups = [{ label: 'Compensation', visibleWhen: cel(GATE), fields: ['salary'] }];
    expect(issuesFor({ sections: [], groups })).toEqual([]);
  });

  it('titles a section by label, then name, then position', () => {
    const body = {
      sections: [
        { name: 'pay', visibleWhen: cel(GATE), fields: ['salary'] },
        { visibleWhen: cel(GATE), fields: ['bonus'] },
      ],
    };
    expect(issuesFor(body).map((i) => i.section)).toEqual(['pay', '#2']);
  });

  it('parses only the predicates of gated sections that hold a required member', () => {
    const body = {
      sections: [
        { name: 'a', visibleWhen: cel(GATE), fields: ['subject'] },
        { name: 'b', visibleWhen: cel(GATE), fields: ['salary'] },
        { name: 'c', visibleWhen: cel(GATE), fields: ['bonus'] },
        { name: 'd', fields: ['salary'] },
      ],
    };
    expect(predicatesToRead(readFormSections(body), FIELDS)).toEqual([GATE]);
  });
});
