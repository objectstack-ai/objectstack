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

  it('resolves a directory named by the id TAIL, and one named by the full `id`', () => {
    writePackageDoc('orders', 'sales_a', 'MARKER-a'); // the last segment of ORDERS.id
    writePackageDoc('com.example.multi.core', 'crm_b', 'MARKER-b'); // the full id

    const { packageDocs } = collectDocsFromSrc(configPath, stack().packages);
    expect(packageDocs.map((s) => [s.dir, s.id, s.docs.map((d) => d.name)])).toEqual([
      ['src/com.example.multi.core/docs', 'com.example.multi.core', ['crm_b']],
      ['src/orders/docs', 'com.example.multi.orders', ['sales_a']],
    ]);
  });

  it('⛔ the package `name` is not a resolution spelling — a display name is not a directory key', () => {
    // `CORE.name` is 'Multi-Package Core', which is neither its `id` nor that
    // id's last segment, so it is the ONE spelling this card's ruling removed.
    // ⚠️ The two directories the sibling cases use cannot prove this: ORDERS
    // spells its `name` 'orders', which is ALSO the tail of its `id`, so a
    // directory named `orders` resolves either way — that is why the removal
    // needs a package whose display name stands alone.
    writePackageDoc('Multi-Package Core', 'crm_display', 'MARKER-display-name');

    const { docs, packageDocs, issues } = collectDocsFromSrc(configPath, stack().packages);
    expect(docs).toEqual([]);
    expect(packageDocs).toEqual([]);
    expect(issues.map((i) => [i.rule, i.severity])).toEqual([['docs/uncollected-directory', 'warning']]);
    expect(issues[0].path).toBe('src/Multi-Package Core/docs');
    expect(issues[0].message).toContain('"Multi-Package Core" names none of this artifact\'s packages');
    // ...and the remedy it prints no longer advertises the spelling it refused.
    expect(issues[0].message).not.toContain('or its `name`');
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
  it('a stack with no packages[] gets the single-package sentence', () => {
    writePackageDoc('sales', 'crm_index', 'MARKER-none');
    const { docs, packageDocs, issues } = collectDocsFromSrc(configPath);

    expect(docs).toEqual([]);
    expect(packageDocs).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].rule).toBe('docs/uncollected-directory');
    expect(issues[0].path).toBe('src/sales/docs');
    // The exact text, so a rewrite of the single-package message fails here
    // rather than in a customer's build log. [#22161] One verdict sentence:
    // the reasoning it used to carry is `os explain docs/uncollected-directory`.
    expect(issues[0].message).toBe(
      '1 Markdown file(s) NOT collected (crm_index.md) — package docs are read from src/docs/ only'
      + ' (ADR-0046 §3.2); move them there',
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

// ── #18965: the docs directory resolves PER REGISTERED PACKAGE, at no depth ─
/**
 * The maintainer's ruling (batch #204 item 5, letter B): `os build` derives
 * each package's docs directory from the packages the artifact REGISTERS, not
 * from a fixed depth under `src/`. A (declare `src/<pkg>/docs/` the convention
 * and rename the reference fixture) and C (scan two levels) were rejected.
 *
 * ## Why the two-level layout is built HERE and not in the reference fixture
 *
 * The ruling names "one test per layout … and `examples/app-multi-package`'s".
 * Measured at `32b5831c4e`, that fixture holds exactly 7 files and no `docs/`
 * directory anywhere, and `git log --diff-filter=AD` over
 * `examples/app-multi-package/**\/docs/**` returns nothing — it never had one.
 * ⭐ Lit control on the same probe: `examples/` holds 256 files, 11 of them
 * under a `/docs/` path, so the probe can see docs directories there.
 *
 * So "one test per layout" needed a choice, and the layout — not the fixture
 * file — is what this collector resolves against:
 *
 *   - ⛔ NOT by adding a docs directory to `examples/app-multi-package`. It is
 *     the ADR-0130 D4 reference fixture and several measurements quote its
 *     contents exactly (`artifact-packages.ts` sizes the per-package
 *     de-duplication residue on it; `build-json-advisory-parity.e2e.test.ts`
 *     reads its artifact), so giving it docs changes what all of them read to
 *     buy what the cases below already prove.
 *   - ⛔ NOR by pinning that fixture's on-disk SHAPE from here. Such a pin
 *     fails the day someone flattens the fixture to `src/<pkg>/` — a change
 *     that, after this card, is harmless in both directions. Pinning a
 *     property this fix deliberately stops being load-bearing would be a pin
 *     that only ever produces false red.
 *
 * ⇒ the layout is reproduced here, where a marker string proves the pedigree
 * of every collected doc, and the reading above is the record that it is the
 * reference fixture's layout being reproduced.
 */
describe('the docs directory is derived from the packages the artifact registers', () => {
  it('collects the ADR-0130 D4 two-level layout and attributes it to the right package', () => {
    const marker = writePackageDoc(path.join('packages', 'orders'), 'sales_playbook', 'MARKER-two-level');
    const { docs, issues, packageDocs } = collectDocsFromSrc(configPath, stack().packages);

    expect(issues).toEqual([]);
    expect(docs).toEqual([]); // ⛔ still not the top level — the #18431 ruling's clause 1
    expect(packageDocs).toHaveLength(1);
    expect(packageDocs[0].index).toBe(1);
    expect(packageDocs[0].id).toBe('com.example.multi.orders');
    expect(packageDocs[0].namespace).toBe('sales');
    expect(packageDocs[0].dir).toBe('src/packages/orders/docs');
    expect(packageDocs[0].docs.map((d) => d.name)).toEqual(['sales_playbook']);
    expect(packageDocs[0].docs[0].content).toContain(marker);
  });

  it('⭐ lit control: the flat layout is collected exactly as before, beside a two-level one', () => {
    const flat = writePackageDoc('core', 'crm_core_guide', 'MARKER-flat-control');
    const nested = writePackageDoc(path.join('packages', 'orders'), 'sales_playbook', 'MARKER-nested');
    const { packageDocs, issues } = collectDocsFromSrc(configPath, stack().packages);

    expect(issues).toEqual([]);
    expect(packageDocs.map((set) => [set.id, set.dir, set.docs.map((d) => d.name)])).toEqual([
      ['com.example.multi.core', 'src/core/docs', ['crm_core_guide']],
      ['com.example.multi.orders', 'src/packages/orders/docs', ['sales_playbook']],
    ]);
    // ⚠️ Pedigree, not count: without these the pair above is satisfied by a
    // collector that read one directory twice.
    expect(packageDocs[0].docs[0].content).toContain(flat);
    expect(packageDocs[1].docs[0].content).toContain(nested);
  });

  it('lints each two-level package against its OWN namespace, end to end', () => {
    writePackageDoc(path.join('packages', 'core'), 'crm_core_guide', 'MARKER-core');
    writePackageDoc(path.join('packages', 'orders'), 'sales_playbook', 'MARKER-orders');
    const { issues, packageDocs } = collectAndLintDocs(configPath, stack());

    expect(issues).toEqual([]);
    expect(packageDocs.map((set) => [set.index, set.dir])).toEqual([
      [0, 'src/packages/core/docs'],
      [1, 'src/packages/orders/docs'],
    ]);
  });

  it('⛔ stops at the package root — a `docs/` deeper inside a resolved package is not a second one', () => {
    writePackageDoc(path.join('packages', 'orders'), 'sales_playbook', 'MARKER-root');
    const inside = path.join(tmp, 'src', 'packages', 'orders', 'components', 'docs');
    fs.mkdirSync(inside, { recursive: true });
    fs.writeFileSync(path.join(inside, 'sales_widget.md'), '# widget');

    const { packageDocs, issues } = collectDocsFromSrc(configPath, stack().packages);
    expect(packageDocs).toHaveLength(1);
    expect(packageDocs[0].dir).toBe('src/packages/orders/docs');
    expect(packageDocs[0].docs.map((d) => d.name)).toEqual(['sales_playbook']);
    // A package's subtree is that package's SOURCE, not more packages — the
    // walk stops at a package root, so this is unchanged from before #18965
    // (the one-level sweep never reached it either).
    expect(issues).toEqual([]);
  });

  it('a directory naming NO package keeps its own answer at the new depth', () => {
    writePackageDoc(path.join('packages', 'billing'), 'crm_index', 'MARKER-unmatched-deep');
    const { packageDocs, issues } = collectDocsFromSrc(configPath, stack().packages);

    expect(packageDocs).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe('docs/uncollected-directory');
    expect(issues[0].path).toBe('src/packages/billing/docs');
    expect(issues[0].message).toContain('"billing" names none of this artifact\'s packages');
  });

  it('an AMBIGUOUS directory name keeps its own answer at the new depth', () => {
    writePackageDoc(path.join('packages', 'core'), 'crm_index', 'MARKER-ambiguous-deep');
    const twins = [pkg({ ...CORE }), pkg({ ...CORE, id: 'com.other.core', name: 'Other Core' })];

    const { packageDocs, issues } = collectDocsFromSrc(configPath, twins);
    expect(packageDocs).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('src/packages/core/docs');
    expect(issues[0].message).toContain('names 2 of this artifact\'s packages');
  });

  it('⛔ ONE package answering to TWO docs directories is refused — never merged, never silently dropped', () => {
    writePackageDoc('orders', 'sales_flat', 'MARKER-loc-flat');
    writePackageDoc(path.join('packages', 'orders'), 'sales_nested', 'MARKER-loc-nested');

    const { packageDocs, issues } = collectDocsFromSrc(configPath, stack().packages);
    // ⛔ Neither is collected: `attachPackageDocs` keys its sets by package
    // index through a Map, so collecting both would drop one without a word.
    expect(packageDocs).toEqual([]);
    expect(issues.map((i) => [i.rule, i.path])).toEqual([
      ['docs/uncollected-directory', 'src/orders/docs'],
      ['docs/uncollected-directory', 'src/packages/orders/docs'],
    ]);
    // Each side names the OTHER, so the author can see both halves from either.
    expect(issues[0].message).toContain('answers to 2 docs directories');
    expect(issues[0].message).toContain('src/packages/orders/docs/');
    expect(issues[1].message).toContain('src/orders/docs/');
  });

  it('⛔ single-package regression: a stack with no packages[] is walked ONE level and reports nothing deeper', () => {
    writePackageDoc(path.join('packages', 'orders'), 'sales_playbook', 'MARKER-invisible');
    const { docs, packageDocs, issues } = collectDocsFromSrc(configPath);

    expect(docs).toEqual([]);
    expect(packageDocs).toEqual([]);
    // With no registered package there is nothing to search FOR, so there is
    // no recursion at all: `src/packages/docs` does not exist, so the sweep
    // finds nothing and says nothing — byte-for-byte the pre-#18965 answer.
    expect(issues).toEqual([]);
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

  it('a link resolves artifact-wide while an embed resolves in its OWNER\'s scope (#27090)', () => {
    // One fixture, both halves. `crm_onboard` sits on the artifact's top level,
    // which the door registers under the artifact's `manifest.id` — `core`'s
    // id — so `core` owns it and its doc may embed it. ⚠️ Before #27090 the
    // embed resolved against the whole stack, the same as the link.
    const FENCE = '```';
    const embed = [`${FENCE}metadata`, 'type: flow\nname: crm_onboard', FENCE].join('\n');
    writePackageDoc('core', 'crm_core_guide', `Link: [o](./crm_orders_guide.md)\n\n${embed}`);
    writePackageDoc('orders', 'crm_orders_guide', `Back: [c](./crm_core_guide.md)\n\n${embed}`);

    const { issues } = collectAndLintDocs(configPath, sharedStack({ flows: [{ name: 'crm_onboard' }] }));
    // Both links resolve; only `orders`' embed is refused — `orders` neither owns
    // the top level nor declares `core`.
    expect(issues.filter((i) => i.severity === 'error').map((i) => [i.rule, i.path])).toEqual([
      ['docs/metadata-embed-ref', 'packages[1].docs/crm_orders_guide'],
    ]);
  });
});

// ── #27090: an embed is judged against the package that ships the doc ──────
describe('docs/metadata-embed-ref judges a package doc against its package and declared dependencies', () => {
  const FENCE = '```';
  const smEmbed = (object: string, name: string) =>
    [`${FENCE}metadata`, `type: state_machine\nobject: ${object}\nname: ${name}`, FENCE].join('\n');
  const lifecycle = (object: string) => ({
    name: object,
    label: object,
    fields: { status: { type: 'text' as const, label: 'Status' } },
    validations: [{
      type: 'state_machine' as const,
      name: `${object}_lifecycle`,
      message: 'Not an allowed status change',
      field: 'status',
      transitions: { new: ['closed'] },
    }],
  });
  const embedRefs = (issues: readonly DocIssue[]) => issues.filter((i) => i.rule === 'docs/metadata-embed-ref');

  /** Two packages of one artifact, the way `composeStacks(…, { manifest: 'preserve' })` writes them. */
  const composed = (serviceDependsOnApp = false, appDependsOnService = false) => composeStacks([
    defineStack({
      manifest: {
        id: 'com.example.split.service', name: 'service', version: '1.0.0', type: 'module', namespace: 'crm',
        ...(serviceDependsOnApp ? { dependencies: { 'com.example.split.app': '^1.0.0' } } : {}),
      },
      objects: [lifecycle('crm_case')],
    }),
    defineStack({
      manifest: {
        id: 'com.example.split.app', name: 'app', version: '1.0.0', type: 'app', namespace: 'crm',
        ...(appDependsOnService ? { dependencies: { 'com.example.split.service': '^1.0.0' } } : {}),
      },
      objects: [lifecycle('crm_account')],
    }),
  ], { manifest: 'preserve' }) as unknown as Record<string, unknown>;

  it('a package doc embedding its OWN package\'s object builds — the card\'s acceptance 1', () => {
    writePackageDoc('service', 'crm_case_guide', smEmbed('crm_case', 'crm_case_lifecycle'));
    const artifact = composed();
    // The measured premise: the composed artifact carries no top-level copy, so
    // the old pass (the artifact's top level) had nothing to resolve against.
    expect(artifact.objects).toBeUndefined();

    const { issues, packageDocs } = collectAndLintDocs(configPath, artifact);
    expect(packageDocs.map((set) => [set.dir, set.docs.map((d) => d.name)])).toEqual([
      ['src/service/docs', ['crm_case_guide']],
    ]);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('...and a dead reference in that same doc is still refused, naming the scope it judged', () => {
    writePackageDoc('service', 'crm_case_guide', smEmbed('crm_cas', 'crm_case_lifecycle'));
    const refused = embedRefs(collectAndLintDocs(configPath, composed()).issues);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ severity: 'error', path: 'packages[0].docs/crm_case_guide' });
    expect(refused[0].message).toContain('which does not exist in this package — did you mean `crm_case`?');
  });

  it('a doc embedding a SIBLING\'s object it does not declare is refused — the card\'s acceptance 2', () => {
    writePackageDoc('app', 'crm_app_guide', smEmbed('crm_case', 'crm_case_lifecycle'));
    const refused = embedRefs(collectAndLintDocs(configPath, composed()).issues);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ severity: 'error', path: 'packages[1].docs/crm_app_guide' });
  });

  it('...and builds once that package DECLARES the sibling in manifest.dependencies', () => {
    writePackageDoc('app', 'crm_app_guide', smEmbed('crm_case', 'crm_case_lifecycle'));
    const { issues } = collectAndLintDocs(configPath, composed(false, true));
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('⛔ a declaration is one-way: the declared package does not reach back', () => {
    // `service` declares `app`; `app` declares nothing. `app`'s doc embedding
    // `service`'s object stays refused, and the message names `app`'s scope.
    writePackageDoc('app', 'crm_app_guide', smEmbed('crm_case', 'crm_case_lifecycle'));
    writePackageDoc('service', 'crm_case_guide', smEmbed('crm_account', 'crm_account_lifecycle'));
    const refused = embedRefs(collectAndLintDocs(configPath, composed(true, false)).issues);
    expect(refused.map((i) => i.path)).toEqual(['packages[1].docs/crm_app_guide']);
  });

  it('a refusal in a package that declares dependencies names them as the scope it judged', () => {
    writePackageDoc('service', 'crm_case_guide', smEmbed('crm_lead', 'crm_lead_lifecycle'));
    const refused = embedRefs(collectAndLintDocs(configPath, composed(true, false)).issues);
    expect(refused).toHaveLength(1);
    expect(refused[0].message).toContain(
      'which does not exist in this package or its declared dependencies (com.example.split.app)',
    );
  });

  it('a package\'s INLINE body doc is judged in the same scope — it was not judged at all before', () => {
    const artifact = composed();
    const packages = artifact.packages as Array<{ manifest: Record<string, unknown> }>;
    packages[0].manifest.docs = [{ name: 'crm_case_inline', content: smEmbed('crm_case', 'crm_case_lifecycle') }];
    packages[1].manifest.docs = [{ name: 'crm_app_inline', content: smEmbed('crm_case', 'crm_case_lifecycle') }];

    const refused = embedRefs(collectAndLintDocs(configPath, artifact).issues);
    // `service`'s own embed builds; `app`'s embed of `service`'s object does not.
    expect(refused.map((i) => i.path)).toEqual(['packages[1].docs/crm_app_inline']);
  });

  it('a flat src/docs/ doc ships on the package the artifact manifest names, and resolves in its scope', () => {
    // `composeStacks` picks the LAST input's manifest, so the flat docs belong to
    // `app` (#22190): its own object resolves, `service`'s does only once `app`
    // declares it.
    writeFlatDoc('crm_index', `${smEmbed('crm_account', 'crm_account_lifecycle')}\n\n${smEmbed('crm_case', 'crm_case_lifecycle')}`);
    const refused = embedRefs(collectAndLintDocs(configPath, composed()).issues);
    expect(refused.map((i) => [i.path, i.message.includes('"crm_case"')])).toEqual([['docs/crm_index', true]]);

    expect(embedRefs(collectAndLintDocs(configPath, composed(false, true)).issues)).toEqual([]);
  });

  it('a stack-level doc embedding a stack object is unchanged, in a stack with no packages[]', () => {
    writeFlatDoc('crm_index', smEmbed('crm_lead', 'crm_lead_lifecycle'));
    const single = { manifest: { namespace: 'crm' }, objects: [lifecycle('crm_lead')] };
    expect(collectAndLintDocs(configPath, single).issues).toEqual([]);

    writeFlatDoc('crm_index', smEmbed('crm_leed', 'crm_lead_lifecycle'));
    const refused = embedRefs(collectAndLintDocs(configPath, single).issues);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ path: 'docs/crm_index' });
    expect(refused[0].message).toContain('which does not exist in this package — did you mean `crm_lead`?');
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
  it('derives exactly two directory spellings per package — ⛔ neither `name` nor `namespace`', () => {
    expect(docsPackageRefs(stack().packages)).toEqual([
      {
        index: 0,
        id: 'com.example.multi.core',
        namespace: 'crm',
        directoryNames: ['com.example.multi.core', 'core'],
      },
      {
        index: 1,
        id: 'com.example.multi.orders',
        namespace: 'sales',
        directoryNames: ['com.example.multi.orders', 'orders'],
      },
    ]);
  });

  it('is empty for an absent `packages`, and refuses a present non-array one', () => {
    expect(docsPackageRefs(undefined)).toEqual([]);
    // #19925: `{}` is malformed, not absent (ruling A on #15293). This row used
    // to pin `[]` for it, which was the silent answer that card removes. The
    // full `{}` / `0` / `'x'` set is pinned in
    // `test/non-array-packages-readers.test.ts`.
    let refusal: { code?: unknown; status?: unknown } | undefined;
    try {
      docsPackageRefs({});
    } catch (error) {
      refusal = error as { code?: unknown; status?: unknown };
    }
    expect(refusal?.code).toBe('INVALID_ARTIFACT_PACKAGES');
    expect(refusal?.status).toBe(422);
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
