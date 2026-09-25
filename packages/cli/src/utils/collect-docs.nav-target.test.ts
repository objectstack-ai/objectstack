// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `docs/nav-target` — a `type: 'doc'` navigation item whose `book` / `doc`
 * names nothing in the package is refused at build, with the remedy in the
 * message (the spec's `DocNavItemSchema`; the "at least one target" half is the
 * schema's own refinement and is pinned in `app-doc-nav-item.test.ts`).
 *
 * Driven through `collectAndLintDocs` on a real `src/docs/` directory as well as
 * through the rule directly: the reason the rule lives in this module is that a
 * doc read off disk is not in the stack `defineStack` saw, so the pin that
 * matters is that such a doc RESOLVES here.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { collectAndLintDocs, lintDocNavTargets } from './collect-docs.js';

const app = (navigation: unknown[]) => ({ name: 'crm_app', label: 'CRM', navigation });

const STACK = {
  manifest: { id: 'com.example.crm', namespace: 'crm' },
  books: [{ name: 'crm_manual', groups: [{ key: 'all', label: 'All', include: 'crm_*' }] }],
};
const DOCS = new Set(['crm_lead_guide', 'crm_intro']);

const navTargetIssues = (navigation: unknown[], stack: Record<string, unknown> = STACK) =>
  lintDocNavTargets({ ...stack, apps: [app(navigation)] }, DOCS);

describe('docs/nav-target — a doc nav item must open something this package has', () => {
  it('resolves a declared book, a carried doc, both, and the package id as the implicit book', () => {
    expect(navTargetIssues([
      { id: 'nav_book', type: 'doc', book: 'crm_manual' },
      { id: 'nav_page', type: 'doc', doc: 'crm_lead_guide' },
      { id: 'nav_both', type: 'doc', book: 'crm_manual', doc: 'crm_intro' },
      { id: 'nav_implicit', type: 'doc', book: 'com.example.crm' },
    ])).toEqual([]);
  });

  it('refuses a doc the package does not carry, naming the nearest doc and both remedies', () => {
    const issues = navTargetIssues([{ id: 'nav_page', type: 'doc', doc: 'crm_lead_gide' }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'error', rule: 'docs/nav-target', path: 'apps/crm_app/navigation/nav_page' });
    expect(issues[0].message).toContain('opens doc "crm_lead_gide", which does not exist in this package');
    expect(issues[0].message).toContain('did you mean `crm_lead_guide`?');
    expect(issues[0].message).toContain('`src/docs/*.md`');
    expect(issues[0].message).toContain('open the whole book with `book`');
  });

  it('refuses a book the package does not declare, offering the implicit-book spelling', () => {
    const issues = navTargetIssues([{ id: 'nav_book', type: 'doc', book: 'crm_manuel' }]);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe('docs/nav-target');
    expect(issues[0].message).toContain('opens book "crm_manuel", which does not exist in this package');
    expect(issues[0].message).toContain('did you mean `crm_manual`?');
    expect(issues[0].message).toContain('"com.example.crm"');
  });

  it('judges both targets of one item independently', () => {
    const issues = navTargetIssues([{ id: 'nav_both', type: 'doc', book: 'ghost_book', doc: 'ghost_doc' }]);
    expect(issues.map((i) => i.message.match(/opens (book|doc)/)?.[1])).toEqual(['book', 'doc']);
  });

  it('walks group children and area navigation, and ignores every other nav type', () => {
    const issues = lintDocNavTargets({
      ...STACK,
      apps: [{
        name: 'crm_app',
        navigation: [
          { id: 'grp', type: 'group', children: [{ id: 'nested', type: 'doc', doc: 'ghost_nested' }] },
          { id: 'nav_page', type: 'page', pageName: 'ghost_doc' },
        ],
        areas: [{ id: 'area_help', navigation: [{ id: 'in_area', type: 'doc', book: 'ghost_area_book' }] }],
      }],
    }, DOCS);
    expect(issues.map((i) => i.path)).toEqual([
      'apps/crm_app/navigation/nested',
      'apps/crm_app/navigation/in_area',
    ]);
  });

  it('judges a doc entry this package contributes into another app', () => {
    const issues = lintDocNavTargets({
      ...STACK,
      manifest: { ...STACK.manifest, navigationContributions: [{ app: 'setup', items: [{ id: 'nav_crm_help', type: 'doc', doc: 'ghost_doc' }] }] },
    }, DOCS);
    expect(issues.map((i) => i.path)).toEqual(['apps/setup/navigation/nav_crm_help']);
  });

  it('resolves a book declared on a package body, and that package id as its implicit book', () => {
    expect(lintDocNavTargets({
      packages: [{ manifest: { id: 'com.example.help', books: [{ name: 'help_centre', groups: [] }] } }],
      apps: [app([
        { id: 'a', type: 'doc', book: 'help_centre' },
        { id: 'b', type: 'doc', book: 'com.example.help' },
      ])],
    }, DOCS)).toEqual([]);
  });
});

describe('docs/nav-target through collectAndLintDocs — a doc read off disk resolves', () => {
  let tmp: string | undefined;
  afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = undefined; });

  const project = (): string => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doc-nav-'));
    fs.mkdirSync(path.join(tmp, 'src', 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'docs', 'crm_lead_guide.md'), '# Lead guide\n\nHow leads work.\n');
    const configPath = path.join(tmp, 'objectstack.config.ts');
    fs.writeFileSync(configPath, 'export default {};\n');
    return configPath;
  };

  it('a nav item naming a src/docs doc passes; one naming a missing doc is a build error', () => {
    const configPath = project();
    const stack = (doc: string) => ({
      manifest: { id: 'com.example.crm', namespace: 'crm' },
      apps: [app([{ id: 'nav_guide', type: 'doc', doc }])],
    });
    const ok = collectAndLintDocs(configPath, stack('crm_lead_guide'));
    expect(ok.issues.filter((i) => i.rule === 'docs/nav-target')).toEqual([]);

    const bad = collectAndLintDocs(configPath, stack('crm_missing_guide'));
    const refused = bad.issues.filter((i) => i.rule === 'docs/nav-target');
    expect(refused).toHaveLength(1);
    expect(refused[0].severity).toBe('error');
    expect(refused[0].message).toContain('"crm_missing_guide", which does not exist in this package');
  });
});
