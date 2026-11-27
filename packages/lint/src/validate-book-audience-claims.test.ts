// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0046 §6.7] `book-gated-catch-all-include`: a book gated by `audience`
 * never claims docs by `include: '*'`. One positive and one negative pin per
 * gated form, the passing claims by name, and the two doors the rule runs at
 * (the CLI registry and the runtime publish gate).
 */

import { describe, expect, it } from 'vitest';
import { AUTHORING_RULES, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import {
  BOOK_GATED_CATCH_ALL_INCLUDE,
  validateBookAudienceClaims,
} from './validate-book-audience-claims.js';

const book = (audience: unknown, include: unknown, extra: Record<string, unknown> = {}) => ({
  name: 'crm_admin_guide',
  label: 'Admin Guide',
  ...(audience === undefined ? {} : { audience }),
  groups: [{ key: 'all', label: 'All', ...(include === undefined ? {} : { include }), ...extra }],
});

const rulesOf = (stack: Record<string, unknown>) => validateBookAudienceClaims(stack).map((f) => f.rule);

describe('validateBookAudienceClaims — a gated book claims its pages by name', () => {
  const GATES = [
    { permissionSet: 'crm_admin' },
    { systemPermission: 'setup.access' },
  ];

  for (const gate of GATES) {
    const form = Object.keys(gate)[0];

    it(`refuses the catch-all on a { ${form} } book`, () => {
      const findings = validateBookAudienceClaims({ books: [book(gate, '*')] });
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: 'error',
        rule: BOOK_GATED_CATCH_ALL_INCLUDE,
        where: 'book "crm_admin_guide"',
        path: 'books[0].groups[0].include',
      });
      expect(findings[0].message).toContain(`${form}:`);
      expect(findings[0].message).toContain('group "all"');
      expect(findings[0].hint).toContain('namespace glob');
    });

    it(`accepts a { ${form} } book that claims by namespace glob, tag or pinned pages`, () => {
      expect(rulesOf({ books: [book(gate, 'crm_admin_*')] })).toEqual([]);
      expect(rulesOf({ books: [book(gate, { tag: 'admin' })] })).toEqual([]);
      expect(rulesOf({ books: [book(gate, undefined, { pages: ['crm_admin_setup'] })] })).toEqual([]);
    });
  }

  it('refuses every all-star spelling and names the group that carries it', () => {
    const stack = {
      books: [{
        name: 'ops_manual',
        audience: { systemPermission: 'ops.access' },
        groups: [
          { key: 'intro', label: 'Intro', include: 'ops_intro_*' },
          { key: 'rest', label: 'Rest', include: '**' },
        ],
      }],
    };
    const findings = validateBookAudienceClaims(stack);
    expect(findings.map((f) => f.path)).toEqual(['books[0].groups[1].include']);
    expect(findings[0].message).toContain('group "rest"');
    expect(findings[0].message).toContain("include: '**'");
  });

  it('leaves a book gated on nothing alone, whatever it claims', () => {
    for (const audience of [undefined, 'org', 'public']) {
      expect(rulesOf({ books: [book(audience, '*')] }), String(audience)).toEqual([]);
    }
  });

  it('reads a map-shaped books collection as well as an array', () => {
    const findings = validateBookAudienceClaims({
      books: { crm_admin_guide: { audience: { permissionSet: 'crm_admin' }, groups: [{ key: 'all', label: 'All', include: '*' }] } },
    });
    expect(findings.map((f) => f.where)).toEqual(['book "crm_admin_guide"']);
  });
});

describe('book-gated-catch-all-include at the authoring doors', () => {
  it('is a gating rule on all three commands and on the runtime publish gate for books', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateBookAudienceClaims');
    expect(entry).toBeDefined();
    expect(entry!.tier).toBe('gating');
    expect(entry!.surfaces).toContain('runtime-publish');
    expect(entry!.runtimeTypes).toEqual(['book']);
    for (const command of ['validate', 'build', 'lint'] as const) {
      const found = runAuthoringRules(command, { normalized: { books: [book({ permissionSet: 'crm_admin' }, '*')] } });
      expect(found.map((f) => f.rule), command).toContain(BOOK_GATED_CATCH_ALL_INCLUDE);
    }
  });

  it('refuses the write of a catch-all gated book at the runtime door, and passes the named claim', () => {
    const refused = runRuntimeAuthoringRules({ type: 'book', item: book({ systemPermission: 'setup.access' }, '*') });
    expect(refused.rulesRun).toContain('validateBookAudienceClaims');
    expect(refused.errors.map((f) => f.rule)).toContain(BOOK_GATED_CATCH_ALL_INCLUDE);

    const named = runRuntimeAuthoringRules({ type: 'book', item: book({ systemPermission: 'setup.access' }, 'crm_admin_*') });
    expect(named.rulesRun).toContain('validateBookAudienceClaims');
    expect(named.errors.map((f) => f.rule)).not.toContain(BOOK_GATED_CATCH_ALL_INCLUDE);
  });
});
