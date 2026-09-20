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
  type DocIssue,
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

/**
 * The same package body with the key REMOVED, not set to `undefined` —
 * `ManifestSchema.namespace` is `.optional()`, so this is a body a real
 * artifact can carry, and it is the FROM side of the changeset's second
 * refused class (N2).
 */
const { namespace: _ordersNamespace, ...ORDERS_NO_NAMESPACE } = ORDERS;

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

  // ── N2: the SECOND class of input this card refuses ──────────────────────
  //
  // Raised by this card's contract review. `ManifestSchema.namespace` is
  // OPTIONAL, so a `packages[i]` body can ship docs while declaring no
  // namespace of its own: before the ruling those docs were judged under
  // `stack.manifest.namespace`, because there was one global prefix rule. The
  // ruling's clause 2 — the OWNING package's namespace, ⛔ with no fallback —
  // makes that body's own namespace the only one that can answer, and ADR-0046
  // §3.2 requires it, so `os build` now refuses with `docs/namespace-required`.
  //
  // The changeset states this class as a cost, in the same FROM → TO form as
  // the first one. These cases are what make that sentence MEASURED rather
  // than asserted; the third is the control that can fail.
  it('REFUSES a namespace-less package that ships DIRECTORY docs — once, at its own manifest.namespace', () => {
    const marker = writePackageDoc('orders', 'sales_playbook', 'MARKER-ns-missing-dir');
    const { issues, packageDocs } = collectAndLintDocs(configPath, {
      manifest: { ...CORE }, // the ARTIFACT declares `crm` — it does not answer for the package
      packages: [pkg({ ...CORE }), pkg({ ...ORDERS_NO_NAMESPACE })],
    });

    // Pedigree: the refusal is about a doc that really came off that directory.
    expect(packageDocs.map((s) => [s.index, s.dir, s.docs.map((d) => d.name)])).toEqual([
      [1, 'src/orders/docs', ['sales_playbook']],
    ]);
    expect(packageDocs[0].docs[0].content).toContain(marker);
    expect(packageDocs[0].namespace).toBeUndefined();

    const required = issues.filter((i) => i.rule === 'docs/namespace-required');
    expect(required).toHaveLength(1);
    expect(required[0].severity).toBe('error');
    expect(required[0].path).toBe('packages[1].manifest.namespace');

    // ⛔ And NOT the prefix rule: there is no namespace to build a prefix from,
    // so re-trying the doc against the artifact's `crm` is exactly the fallback
    // clause 2 forbids. One refusal, naming the one thing the author must add.
    expect(issues.filter((i) => i.rule === 'docs/namespace-prefix')).toEqual([]);
  });

  it('...and the same refusal for a namespace-less package that ships INLINE body docs', () => {
    // ⚠️ The doc is named `crm_orders_inline`, ⛔ not `sales_orders_inline`, so
    // the fixture is a MEMBER of the class the changeset describes. Under the
    // old single global rule this name carried the artifact's `crm` prefix and
    // was ACCEPTED; a `sales_`-prefixed name would already have been refused
    // then, which would measure only the TO side of a FROM → TO pair.
    const { issues } = collectAndLintDocs(configPath, {
      manifest: { ...CORE },
      packages: [
        pkg({ ...CORE }),
        pkg({ ...ORDERS_NO_NAMESPACE, docs: [{ name: 'crm_orders_inline', content: '# Inline' }] }),
      ],
    });

    const required = issues.filter((i) => i.rule === 'docs/namespace-required');
    expect(required).toHaveLength(1);
    expect(required[0].severity).toBe('error');
    expect(required[0].path).toBe('packages[1].manifest.namespace');
    expect(required[0].message).toContain('ADR-0046 §3.2');
    expect(issues.filter((i) => i.rule === 'docs/namespace-prefix')).toEqual([]);
  });

  it('...while the SAME package with its namespace declared raises neither — the control that can fail', () => {
    writePackageDoc('orders', 'sales_playbook', 'MARKER-ns-declared');
    const { issues } = collectAndLintDocs(configPath, stack()); // ORDERS declares `sales`

    expect(issues.filter((i) => i.rule === 'docs/namespace-required')).toEqual([]);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  // ── N4: a hand-written `packages[i].manifest.docs` with NO top-level twin ──
  //
  // Raised by this card's SECOND contract review, and verified at this base:
  //
  //   - `packages` is an AUTHORABLE stack key (`ObjectStackDefinitionSchema`,
  //     `packages/spec/src/stack.zod.ts`), and its docblock says a hand-written
  //     entry "still parses — it is an assembled body carrying no collections";
  //   - `AssembledPackageBodySchema` is the manifest plus every `concat` /
  //     `objects` / `functions` collection that is NOT an artifact-envelope key
  //     (`packages`, `plugins`, `devPlugins`, `devLogins`), and `docs` is
  //     `concat`, so a body may carry `docs`;
  //   - `DocSchema.name` says a namespace prefix is "recommended, not required";
  //   - BEFORE this card nothing linted such a doc. `collectAndLintDocs` read
  //     `stack.docs` plus `src/docs/` and never looked at `packages[]`, and
  //     `@objectstack/lint` contains no `.docs` read at all — the two rules that
  //     do walk `packages[]` (`validate-object-references`,
  //     `validate-translation-references`) never mention it. `os build` exited 0
  //     on any doc name.
  //
  // Under clause 2 that doc is the package's doc, so `bodyDocsOf` puts it in
  // `owned` and every docs rule reaches it under the package's namespace.
  //
  // ⚠️ `lints a package's INLINE body docs against that package too` above does
  // ⛔ NOT cover this: that fixture is the COMPOSED shape, where the SAME item
  // object also sits at the artifact top level and therefore did reach the old
  // global lint through `stack.docs`. The FROM side here is the shape with no
  // top-level twin at all, which reached nothing.
  it('REFUSES a hand-written packages[i].manifest.docs entry that has NO top-level twin', () => {
    const artifact = {
      manifest: { ...CORE },
      // ⛔ No `docs` key on the artifact: the doc exists ONLY on the body, which
      // is what made it unreachable by the old single global lint.
      packages: [pkg({ ...CORE }), pkg({ ...ORDERS, docs: [{ name: 'playbook', content: '# Playbook' }] })],
    };
    expect(artifact).not.toHaveProperty('docs');

    const { docs, packageDocs, issues } = collectAndLintDocs(configPath, artifact);

    // Pedigree: nothing was read off disk and the top level carries nothing, so
    // the refusal can only be about the hand-written body entry.
    expect(packageDocs).toEqual([]);
    expect(docs).toEqual([]);

    const refusal = issues.filter((i) => i.rule === 'docs/namespace-prefix');
    expect(refusal).toHaveLength(1);
    expect(refusal[0].severity).toBe('error');
    expect(refusal[0].path).toBe('packages[1].docs/playbook');
    expect(refusal[0].message).toContain('rename to "sales_playbook"');
  });

  it('...while the same hand-written entry under its OWN prefix raises nothing — the control that can fail', () => {
    const { issues } = collectAndLintDocs(configPath, {
      manifest: { ...CORE },
      packages: [pkg({ ...CORE }), pkg({ ...ORDERS, docs: [{ name: 'sales_playbook', content: '# Playbook' }] })],
    });

    expect(issues.filter((i) => i.rule === 'docs/namespace-prefix')).toEqual([]);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
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

// ── C2 — the ownership split must not answer the EXISTENCE question ─────────
//
// Raised by this card's contract review and pinned HERE, in the unit tier, so
// it runs on the pull request that would reintroduce it. The e2e file next door
// carries the `.e2e.` filename tier, which is the NIGHTLY run — a pin that only
// ever runs after the merge is not what catches this.
//
// The defect it holds shut: `lintDocs` resolves a same-prefix link against the
// set it is handed. Partitioning the doc set per package (clause 2) silently
// made that set ONE PACKAGE, so in the ADR-0130 D1 shape — N packages sharing
// one namespace, the shape this card calls the common one — an ordinary link
// from package A's doc to package B's doc became `docs/broken-link`, an ERROR,
// and an artifact that built green stopped building. That is an unauthorised,
// undisclosed narrowing of the accept set.
//
// ⚠️ Each direction is asserted with a TRUE-POSITIVE twin built from the same
// fixture. A run of the "no broken link" side alone is indistinguishable from
// deleting the rule, which is the one outcome that must not read as a pass.
describe('same-prefix links resolve ARTIFACT-WIDE, not per package (C2)', () => {
  /** Two packages sharing one namespace — ADR-0130 D1's whole point. */
  const SHARED_NS = [
    pkg({ ...CORE, namespace: 'crm', name: 'core' }),
    pkg({ ...ORDERS, namespace: 'crm', name: 'orders' }),
  ];
  const sharedStack = (extra: Record<string, unknown> = {}) => ({
    manifest: { ...CORE, namespace: 'crm' },
    packages: SHARED_NS,
    ...extra,
  });
  const brokenLinks = (issues: readonly DocIssue[]) => issues.filter((i) => i.rule === 'docs/broken-link');

  it('a link across two packages sharing one namespace resolves, in both directions', () => {
    // `core` links to a doc `orders` owns, and `orders` links back.
    writePackageDoc('core', 'crm_core_guide', 'See [orders](./crm_orders_guide.md).');
    writePackageDoc('orders', 'crm_orders_guide', 'Back to [core](./crm_core_guide.md).');

    const { issues, packageDocs } = collectAndLintDocs(configPath, sharedStack());

    // Pedigree first: both directories really were read, so "no broken link"
    // is not the silence of a pass that collected nothing.
    expect(packageDocs.map((s) => [s.dir, s.docs.map((d) => d.name)])).toEqual([
      ['src/core/docs', ['crm_core_guide']],
      ['src/orders/docs', ['crm_orders_guide']],
    ]);
    expect(brokenLinks(issues)).toEqual([]);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('...while a target NO package provides is still an error — the control that can fail', () => {
    writePackageDoc('core', 'crm_core_guide', 'See [ghost](./crm_ghost.md).');
    writePackageDoc('orders', 'crm_orders_guide', '# Orders');

    const broken = brokenLinks(collectAndLintDocs(configPath, sharedStack()).issues);
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ severity: 'error', path: 'packages[0].docs/crm_core_guide' });
  });

  it('a flat src/docs/ doc links to a package-carried doc under the stack prefix, and back', () => {
    const inlineDoc: DocItem = { name: 'crm_inline', content: 'Up to [index](./crm_index.md).' };
    writeFlatDoc('crm_index', '# Index\n\nDown to [inline](./crm_inline.md).');

    const { issues } = collectAndLintDocs(configPath, sharedStack({
      docs: [inlineDoc],
      packages: [SHARED_NS[0], pkg({ ...ORDERS, namespace: 'crm', name: 'orders', docs: [inlineDoc] })],
    }));

    expect(brokenLinks(issues)).toEqual([]);
  });

  it('...and the same pair with the target removed is an error on both ends', () => {
    // Same fixture, one half deleted: the flat doc's target is gone and the
    // package doc's target is gone, so BOTH ends report.
    writeFlatDoc('crm_index', '# Index\n\nDown to [inline](./crm_inline.md).');
    writePackageDoc('orders', 'crm_orders_guide', 'Up to [missing](./crm_missing.md).');

    const broken = brokenLinks(collectAndLintDocs(configPath, sharedStack()).issues);
    expect(broken.map((i) => i.path).sort()).toEqual(['docs/crm_index', 'packages[1].docs/crm_orders_guide']);
  });

  it('a target under ANOTHER package\'s prefix is still skipped as a cross-package link', () => {
    // Unchanged behaviour, asserted so the widening above is not read as
    // "every link is now checked": a different prefix is resolved at publish
    // time against dependency docs, not here.
    writePackageDoc('orders', 'sales_playbook', 'See [foreign](./other_thing.md).');
    const differentNs = [pkg({ ...CORE }), pkg({ ...ORDERS })]; // crm + sales

    const { issues } = collectAndLintDocs(configPath, { manifest: { ...CORE }, packages: differentNs });
    expect(brokenLinks(issues)).toEqual([]);
  });

  it('metadata embeds and links are partitioned the SAME way — artifact-wide', () => {
    // The inconsistency the review named: embeds already resolved artifact-wide
    // while links did not. One fixture, both halves, one verdict.
    const FENCE = '```';
    const embed = [`${FENCE}metadata`, 'type: flow\nname: crm_onboard', FENCE].join('\n');
    writePackageDoc('core', 'crm_core_guide', `Link: [o](./crm_orders_guide.md)\n\n${embed}`);
    writePackageDoc('orders', 'crm_orders_guide', '# Orders');

    const { issues } = collectAndLintDocs(configPath, sharedStack({
      // `crm_onboard` is owned by the artifact, not by `core` — an embed has
      // always resolved against the whole stack, and now a link does too.
      flows: [{ name: 'crm_onboard' }],
    }));
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
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
