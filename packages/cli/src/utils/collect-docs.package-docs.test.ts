// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18431 — per-package docs: `src/<pkg>/docs/` read into the OWNING package's
 * body, and linted against that package's OWN namespace.
 *
 * The maintainer's ruling (batch #147 item 4) decided the two contract
 * questions #18170 left open, and every case here is one of its clauses:
 *
 *   1. per-package docs attach to `packages[i]` — ⛔ not the artifact top level;
 *   2. the doc lint uses the OWNING package's `namespace`; a doc outside any
 *      package keeps `stack.manifest.namespace`, and there is ⛔ no single
 *      global prefix;
 *   3. the directory convention (`src/<pkg>/docs/`) is the one implemented
 *      first — the `defineStack({ docs })` spelling already reaches
 *      `packages[i].manifest.docs` through `composeStacks(…, { manifest:
 *      'preserve' })`, which is measured in `package-body-docs-are-composed`
 *      below so the claim is not just asserted in a PR body;
 *   4. the #18428 warning STAYS for docs in a place neither convention reads.
 *
 * ⚠️ Every assertion that a per-package pass "produced something" also asserts
 * its PEDIGREE — the directory it came from, the package it was attributed to,
 * and a marker string written into that one file — because a count alone is
 * satisfied by an echo of a doc that was already somewhere else.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { composeStacks, defineStack } from '@objectstack/spec';

import {
  attachPackageDocs,
  collectAndLintDocs,
  collectDocsFromSrc,
  docsPackageRefs,
  type DocItem,
} from './collect-docs.js';

let tmp: string;
let configPath: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-pkg-docs-'));
  configPath = path.join(tmp, 'objectstack.config.ts');
  fs.writeFileSync(configPath, '// stub');
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Write one Markdown file into `src/<dir>/docs/`, and hand back its marker. */
const writePackageDoc = (dir: string, name: string, marker: string): string => {
  const target = path.join(tmp, 'src', dir, 'docs');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, `${name}.md`), `# ${name}\n\n${marker}\n`);
  return marker;
};

const writeFlatDoc = (name: string, body: string) => {
  const target = path.join(tmp, 'src', 'docs');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, `${name}.md`), body);
};

/** An artifact `packages[]` entry, in the `{ manifest: <body> }` wrapper D4 reserves. */
const pkg = (body: Record<string, unknown>) => ({ manifest: body });

const CORE = {
  id: 'com.example.multi.core',
  name: 'Multi-Package Core',
  namespace: 'crm',
  version: '1.0.0',
  type: 'app',
};
const ORDERS = {
  id: 'com.example.multi.orders',
  name: 'orders',
  namespace: 'sales',
  version: '1.0.0',
  type: 'module',
};

/** The composed artifact these fixtures stand in for: two packages, `crm` on top. */
const stack = (extra: Record<string, unknown> = {}) => ({
  manifest: { ...CORE },
  packages: [pkg({ ...CORE }), pkg({ ...ORDERS })],
  ...extra,
});

// ── Clause 3's measurement, held as a test rather than as a sentence ────────
describe('the `defineStack({ docs })` spelling needs no collector work at all', () => {
  it('package-body-docs-are-composed: `preserve` already puts a package\'s inline docs on its own body', () => {
    const core = defineStack({
      manifest: { id: 'com.example.p.core', name: 'core', version: '1.0.0', type: 'app', namespace: 'crm' },
      docs: [{ name: 'crm_core_guide', label: 'Core', content: '# Core' }],
    });
    const orders = defineStack({
      manifest: { id: 'com.example.p.orders', name: 'orders', version: '1.0.0', type: 'module', namespace: 'sales' },
      docs: [{ name: 'sales_orders_guide', label: 'Orders', content: '# Orders' }],
    });
    const composed = composeStacks([core, orders], { manifest: 'preserve' }) as unknown as {
      packages: Array<{ manifest: { id: string; docs?: DocItem[] } }>;
    };

    // This is the whole of the "which convention costs a second traversal"
    // measurement: this one costs no traversal because composition already did
    // the attribution — so the DIRECTORY convention is what was implemented.
    expect(composed.packages.map((p) => [p.manifest.id, (p.manifest.docs ?? []).map((d) => d.name)])).toEqual([
      ['com.example.p.core', ['crm_core_guide']],
      ['com.example.p.orders', ['sales_orders_guide']],
    ]);
  });
});

// ── Clause 1: collection + attribution ─────────────────────────────────────
describe('collectDocsFromSrc reads src/<pkg>/docs/ for a resolvable package', () => {
  it('attributes a directory named by the last segment of the package id, with its pedigree', () => {
    const marker = writePackageDoc('orders', 'sales_playbook', 'MARKER-orders-playbook');
    const { docs, issues, packageDocs } = collectDocsFromSrc(configPath, stack().packages);

    expect(issues).toEqual([]);
    expect(docs).toEqual([]); // ⛔ NOT the top level — the ruling's clause 1
    expect(packageDocs).toHaveLength(1);
    const [set] = packageDocs;
    // Pedigree, not just a count: where it was read, who owns it, what is in it.
    expect(set.dir).toBe('src/orders/docs');
    expect(set.index).toBe(1);
    expect(set.id).toBe('com.example.multi.orders');
    expect(set.namespace).toBe('sales');
    expect(set.docs.map((d) => d.name)).toEqual(['sales_playbook']);
    expect(set.docs[0].content).toContain(marker);
    expect(set.docs[0].label).toBe('sales_playbook'); // the first `#` heading
  });

  it('resolves a directory named by the package `name`, and one named by the full `id`', () => {
    writePackageDoc('orders', 'sales_a', 'MARKER-a'); // ORDERS.name === 'orders'
    writePackageDoc('com.example.multi.core', 'crm_b', 'MARKER-b'); // the full id

    const { packageDocs } = collectDocsFromSrc(configPath, stack().packages);
    expect(packageDocs.map((s) => [s.dir, s.id, s.docs.map((d) => d.name)])).toEqual([
      ['src/com.example.multi.core/docs', 'com.example.multi.core', ['crm_b']],
      ['src/orders/docs', 'com.example.multi.orders', ['sales_a']],
    ]);
  });

  it('keeps reading the flat src/docs/ alongside the per-package ones', () => {
    writeFlatDoc('crm_index', '# CRM');
    writePackageDoc('orders', 'sales_playbook', 'MARKER-both');

    const { docs, packageDocs, issues } = collectDocsFromSrc(configPath, stack().packages);
    expect(docs.map((d) => d.name)).toEqual(['crm_index']);
    expect(packageDocs.flatMap((s) => s.docs.map((d) => d.name))).toEqual(['sales_playbook']);
    expect(issues).toEqual([]);
  });

  it('applies the flatness rule inside a package directory, naming THAT directory', () => {
    writePackageDoc('orders', 'sales_ok', 'MARKER-flat');
    fs.mkdirSync(path.join(tmp, 'src', 'orders', 'docs', 'deep'));
    fs.writeFileSync(path.join(tmp, 'src', 'orders', 'docs', 'deep', 'sales_x.md'), '# x');

    const { issues, packageDocs } = collectDocsFromSrc(configPath, stack().packages);
    expect(issues.map((i) => [i.rule, i.path])).toEqual([['docs/flat-directory', 'src/orders/docs/deep']]);
    expect(issues[0].message).toContain('under src/orders/docs/');
    // ...and the sibling file is still collected, so the error is not a bail-out.
    expect(packageDocs[0].docs.map((d) => d.name)).toEqual(['sales_ok']);
  });
});

// ── Clause 4: the #18428 warning stays, and says WHY ───────────────────────
describe('the #18170 warning stays for a directory neither convention reads', () => {
  it('a stack with no packages[] gets the original sentence, unchanged', () => {
    writePackageDoc('sales', 'crm_index', 'MARKER-none');
    const { docs, packageDocs, issues } = collectDocsFromSrc(configPath);

    expect(docs).toEqual([]);
    expect(packageDocs).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].rule).toBe('docs/uncollected-directory');
    expect(issues[0].path).toBe('src/sales/docs');
    // The exact pre-#18431 text, so a rewrite of the single-package message
    // fails here rather than in a customer's build log.
    expect(issues[0].message).toBe(
      'src/sales/docs/ holds 1 Markdown file(s) that were NOT collected: package docs are read from src/docs/ only'
      + " (ADR-0046 §3.2), so these are absent from the artifact's `docs[]` and from every book that includes them."
      + ' Move them into src/docs/ (doc names carry the package namespace prefix, so packages do not collide there),'
      + ' declare them inline as `defineStack({ docs })`, or delete them if they are not package docs.'
      + ' Found: crm_index.md',
    );
  });

  it('a directory naming NO package is reported with the declared package list', () => {
    writePackageDoc('billing', 'crm_index', 'MARKER-unmatched');
    const { packageDocs, issues } = collectDocsFromSrc(configPath, stack().packages);

    expect(packageDocs).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].rule).toBe('docs/uncollected-directory');
    expect(issues[0].message).toContain('"billing" names none of this artifact\'s packages');
    expect(issues[0].message).toContain('com.example.multi.core, com.example.multi.orders');
    expect(issues[0].message).toContain('crm_index.md');
  });

  it('an AMBIGUOUS directory is reported and ⛔ never guessed', () => {
    writePackageDoc('core', 'crm_index', 'MARKER-ambiguous');
    const twins = [pkg({ ...CORE }), pkg({ ...CORE, id: 'com.other.core', name: 'Other Core' })];

    const { packageDocs, issues } = collectDocsFromSrc(configPath, twins);
    expect(packageDocs).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('names 2 of this artifact\'s packages');
    expect(issues[0].message).toContain('com.example.multi.core, com.other.core');
  });

  it('⛔ namespace is not a resolution spelling — shared namespaces are the ADR-0130 D1 case', () => {
    // Both packages declare `crm`; a `src/crm/docs` directory must therefore
    // resolve to NEITHER, not to the first one that happens to match.
    writePackageDoc('crm', 'crm_index', 'MARKER-ns');
    const shared = [pkg({ ...CORE }), pkg({ ...ORDERS, namespace: 'crm' })];

    const { packageDocs, issues } = collectDocsFromSrc(configPath, shared);
    expect(packageDocs).toEqual([]);
    expect(issues.map((i) => i.rule)).toEqual(['docs/uncollected-directory']);
    expect(issues[0].message).toContain('"crm" names none of this artifact\'s packages');
  });
});

// ── Clause 2: one prefix rule per package ──────────────────────────────────
describe('the doc lint reads the OWNING package namespace', () => {
  it('accepts a package doc carrying its OWN package prefix, not the artifact manifest one', () => {
    writePackageDoc('orders', 'sales_playbook', 'MARKER-ns-own');
    const { issues } = collectAndLintDocs(configPath, stack());

    // `stack.manifest.namespace` is `crm`; the owning package's is `sales`.
    // Before the ruling this was a build-failing `docs/namespace-prefix`.
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('REFUSES a package doc carrying the artifact prefix instead of its own — no fallback', () => {
    writePackageDoc('orders', 'crm_playbook', 'MARKER-ns-wrong');
    const { issues } = collectAndLintDocs(configPath, stack());

    const refusal = issues.filter((i) => i.rule === 'docs/namespace-prefix');
    expect(refusal).toHaveLength(1);
    expect(refusal[0].severity).toBe('error');
    expect(refusal[0].path).toBe('packages[1].docs/crm_playbook');
    expect(refusal[0].message).toContain('rename to "sales_crm_playbook"');
  });

  it('a stack-level doc outside any package keeps stack.manifest.namespace', () => {
    writeFlatDoc('sales_orphan', '# Orphan'); // `sales` is a PACKAGE namespace, not the stack's
    const { issues } = collectAndLintDocs(configPath, stack());

    const refusal = issues.filter((i) => i.rule === 'docs/namespace-prefix');
    expect(refusal).toHaveLength(1);
    expect(refusal[0].path).toBe('docs/sales_orphan'); // no `packages[i].` prefix
    expect(refusal[0].message).toContain('rename to "crm_sales_orphan"');
  });

  it('lints a package\'s INLINE body docs against that package too, and only once', () => {
    const inlineDoc: DocItem = { name: 'crm_orders_inline', content: '# Inline' };
    const composedShape = {
      manifest: { ...CORE },
      // What `composeStacks(…, { manifest: 'preserve' })` produces: the SAME
      // item object on the body and in the flattened top level.
      docs: [inlineDoc],
      packages: [pkg({ ...CORE }), pkg({ ...ORDERS, docs: [inlineDoc] })],
    };

    const { issues } = collectAndLintDocs(configPath, composedShape);
    const refusal = issues.filter((i) => i.rule === 'docs/namespace-prefix');
    expect(refusal).toHaveLength(1); // once — judged by `sales`, not twice by `sales` and `crm`
    expect(refusal[0].path).toBe('packages[1].docs/crm_orders_inline');
  });

  it('reports a doc name declared by two different owners — the one thing per-package lint cannot see', () => {
    writePackageDoc('core', 'crm_shared', 'MARKER-dup-core');
    writePackageDoc('orders', 'crm_shared', 'MARKER-dup-orders');
    // Both packages share one namespace, which is exactly what ADR-0130 D1 buys
    // — so the prefix rule does NOT keep these apart.
    const shared = [pkg({ ...CORE }), pkg({ ...ORDERS, namespace: 'crm', name: 'orders' })];

    const { issues } = collectAndLintDocs(configPath, { manifest: { ...CORE }, packages: shared });
    const dup = issues.filter((i) => i.rule === 'docs/duplicate-name');
    expect(dup).toHaveLength(1);
    expect(dup[0].severity).toBe('error');
    expect(dup[0].message).toContain('package "com.example.multi.core" and package "com.example.multi.orders"');
  });
});

// ── "Nothing existing moves" — the single-package shape, item for item ─────
describe('a stack with no packages[] is on the path it was always on', () => {
  it('produces the same docs and the same issues whether or not `packages` is passed', () => {
    writeFlatDoc('crm_index', '# CRM Overview\n\n[link](./crm_missing.md)');
    writePackageDoc('sales', 'crm_moved', 'MARKER-unchanged');
    const single = { manifest: { namespace: 'crm' } };

    const withoutArg = collectDocsFromSrc(configPath);
    const withEmpty = collectDocsFromSrc(configPath, undefined);
    expect(withEmpty).toEqual(withoutArg);

    const linted = collectAndLintDocs(configPath, single);
    expect(linted.docs.map((d) => d.name)).toEqual(['crm_index']);
    expect(linted.packageDocs).toEqual([]);
    // The broken link and the uncollected directory, exactly as before — no
    // per-package path taken, no issue re-located under a `packages[i].`.
    expect(linted.issues.map((i) => [i.rule, i.path])).toEqual([
      ['docs/uncollected-directory', 'src/sales/docs'],
      ['docs/broken-link', 'docs/crm_index'],
    ]);
  });
});

// ── docsPackageRefs + attachPackageDocs ────────────────────────────────────
describe('docsPackageRefs', () => {
  it('derives exactly three directory spellings per package, and no namespace', () => {
    expect(docsPackageRefs(stack().packages)).toEqual([
      {
        index: 0,
        id: 'com.example.multi.core',
        namespace: 'crm',
        directoryNames: ['com.example.multi.core', 'core', 'Multi-Package Core'],
      },
      {
        index: 1,
        id: 'com.example.multi.orders',
        namespace: 'sales',
        directoryNames: ['com.example.multi.orders', 'orders'],
      },
    ]);
  });

  it('is empty for anything that is not an array', () => {
    expect(docsPackageRefs(undefined)).toEqual([]);
    expect(docsPackageRefs({})).toEqual([]);
  });
});

describe('attachPackageDocs', () => {
  const set = (index: number, names: string[]) => ({
    index,
    id: `p${index}`,
    dir: `src/p${index}/docs`,
    docs: names.map((name) => ({ name, content: `# ${name}` })),
  });

  it('writes onto packages[i].manifest.docs and leaves every other entry alone', () => {
    const packages = [pkg({ ...CORE }), pkg({ ...ORDERS })];
    const out = attachPackageDocs(packages, [set(1, ['sales_playbook'])]) as Array<{
      manifest: Record<string, unknown>;
    }>;

    expect(out[0]).toBe(packages[0]); // untouched entry keeps its identity
    expect((out[1].manifest.docs as DocItem[]).map((d) => d.name)).toEqual(['sales_playbook']);
    expect(packages[1].manifest).not.toHaveProperty('docs'); // ⛔ no mutation in place
  });

  it('appends after the docs the body already carried, without duplicating them', () => {
    const existing: DocItem = { name: 'sales_inline', content: '# Inline' };
    const packages = [pkg({ ...ORDERS, docs: [existing] })];
    const out = attachPackageDocs(packages, [
      { ...set(0, ['sales_playbook']), docs: [existing, { name: 'sales_playbook', content: '# sales_playbook' }] },
    ]) as Array<{ manifest: { docs: DocItem[] } }>;

    expect(out[0].manifest.docs.map((d) => d.name)).toEqual(['sales_inline', 'sales_playbook']);
  });

  it('hands back the ARGUMENT when it adds nothing — identity, not equality', () => {
    const packages = [pkg({ ...CORE })];
    expect(attachPackageDocs(packages, [])).toBe(packages);
    expect(attachPackageDocs(packages, [set(0, [])])).toBe(packages);
    expect(attachPackageDocs(undefined, [set(0, ['x'])])).toBeUndefined();
  });
});
