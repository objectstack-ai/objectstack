// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `doc` navigation item (ADR-0046) — one variant targeting a `book` and/or
 * a `doc`, at least one required.
 *
 * What is pinned here is the SHAPE half: the three accepted target shapes, the
 * refusal of the target-less item with a remedy naming both keys, the per-variant
 * strict surface, and that the "at least one" rule reaches the published JSON
 * Schema rather than living in the refinement alone. Whether a named book / doc
 * EXISTS is a package question, answered by the CLI's `docs/nav-target` lint
 * (`packages/cli/src/utils/collect-docs.nav-target.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { AppSchema, DocNavItemSchema, NavigationItemSchema } from './app.zod';
import { projectPublishedJsonSchema } from '../../scripts/lib/refinement-projection';

const withNav = (navigation: unknown[]) => ({ name: 'crm_app', label: 'CRM', navigation });

describe('DocNavItemSchema — targets', () => {
  it.each([
    ['a book', { book: 'crm_manual' }],
    ['a doc', { doc: 'crm_lead_guide' }],
    ['both', { book: 'crm_manual', doc: 'crm_lead_guide' }],
    ['the package id as the implicit book', { book: 'com.example.crm' }],
  ])('accepts %s', (_name, target) => {
    const r = AppSchema.safeParse(withNav([{ id: 'nav_help', type: 'doc', label: 'Help', ...target }]));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('accepts a doc entry nested under a group, with the base gating keys', () => {
    const r = AppSchema.safeParse(withNav([{
      id: 'grp_help', type: 'group', label: 'Help',
      children: [{ id: 'nav_guide', type: 'doc', doc: 'crm_lead_guide', requiredPermissions: ['crm_read'], icon: 'book' }],
    }]));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('refuses an item with neither target, with a remedy naming both keys', () => {
    const r = AppSchema.safeParse(withNav([{ id: 'nav_help', type: 'doc', label: 'Help' }]));
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.code === 'custom');
    expect(issue, JSON.stringify(r.error!.issues)).toBeDefined();
    expect(issue!.path).toEqual(['navigation', 0]);
    expect(issue!.message).toContain('`book`');
    expect(issue!.message).toContain('`doc`');
  });

  it('refuses the target-less item on the standalone schema too — the rule is on the export, not only the mount', () => {
    expect(DocNavItemSchema.safeParse({ id: 'nav_help', type: 'doc' }).success).toBe(false);
    expect(DocNavItemSchema.safeParse({ id: 'nav_help', type: 'doc', book: 'crm_manual' }).success).toBe(true);
  });

  it('refuses a filename or a path as a doc target', () => {
    for (const doc of ['crm_lead_guide.md', 'docs/crm_lead_guide', 'CrmLeadGuide']) {
      const r = NavigationItemSchema.safeParse({ id: 'nav_guide', type: 'doc', doc });
      expect(r.success, doc).toBe(false);
      expect(JSON.stringify(r.error!.issues), doc).toContain('filename stem');
    }
  });

  it('refuses an empty book target', () => {
    expect(NavigationItemSchema.safeParse({ id: 'nav_help', type: 'doc', book: '' }).success).toBe(false);
  });
});

describe('DocNavItemSchema — the per-variant strict surface', () => {
  const unknownKeyMessage = (item: Record<string, unknown>): string => {
    const r = NavigationItemSchema.safeParse(item);
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue, JSON.stringify(r.error!.issues)).toBeDefined();
    return issue!.message;
  };

  it('answers the sibling-analogy spellings with the real keys', () => {
    expect(unknownKeyMessage({ id: 'n', type: 'doc', docName: 'crm_lead_guide' })).toContain('`docName` → `doc`');
    expect(unknownKeyMessage({ id: 'n', type: 'doc', bookName: 'crm_manual' })).toContain('`bookName` → `book`');
  });

  it('points `book` / `doc` written on another variant at `type: \'doc\'`', () => {
    expect(unknownKeyMessage({ id: 'n', type: 'page', pageName: 'home', doc: 'crm_lead_guide' }))
      .toContain("type: 'doc' (with doc)");
    expect(unknownKeyMessage({ id: 'n', type: 'url', url: 'https://x', book: 'crm_manual' }))
      .toContain("type: 'doc' (with book)");
  });

  it('points another variant\'s target key at its own type', () => {
    expect(unknownKeyMessage({ id: 'n', type: 'doc', book: 'crm_manual', pageName: 'home' }))
      .toContain("type: 'page' (with pageName)");
  });
});

describe('DocNavItemSchema — the "at least one target" rule reaches the JSON Schema', () => {
  it('the published projection carries it as anyOf-of-required, not only the refinement', () => {
    const json = JSON.stringify(projectPublishedJsonSchema(DocNavItemSchema as unknown as z.ZodType));
    expect(json).toContain('"required":["book"]');
    expect(json).toContain('"required":["doc"]');
  });
});
