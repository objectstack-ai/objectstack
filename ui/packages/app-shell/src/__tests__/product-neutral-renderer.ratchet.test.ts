/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The product-neutral renderer ratchet (ADR-0060; AGENTS.md › Product-neutral
 * renderer).
 *
 * objectui renders for every product the same way. A product composes its
 * pages from generic blocks and keeps its copy in its own bundles; a page that
 * cannot be composed is fixed by a GENERIC block here or by a contract door in
 * `@objectstack/spec` — never by a widget, dialog, hook or i18n namespace named
 * for the product that needed it. What already exists stays until its page
 * migrates, and may only shrink. This file holds that, mechanically, for the
 * three things it can read: registry keys, file names, and locale keys.
 *
 * ## What is measured, on every run
 *
 *   REGISTRATIONS  every component registry key the repository's ONE
 *                  registration derivation (`deriveRegistryKeys`, the reader
 *                  behind `objectui check`'s known-type list and the doc-type
 *                  gate) produces whose colon-separated segment leads with a
 *                  product word. Both spellings of a registration land here,
 *                  because both store the same key: `register('cloud:x', C)`
 *                  and `register('x', C, { namespace: 'cloud' })`. A literal
 *                  `register('cloud:` grep sees only the first; the fixture
 *                  control below pins that this reader sees both.
 *   FILES          every non-test file under `packages/`, `apps/` and
 *                  `examples/` that sits in a frozen directory, or whose path
 *                  has a segment led by a product word (`CloudPlanStatus.tsx`,
 *                  `cloud-connection/`, `useCloudThing.ts`).
 *   LOCALE KEYS    in every built-in locale, every leaf key under a frozen
 *                  namespace; and, anywhere in the catalogue, every key whose
 *                  own name leads with a product word.
 *
 * ## Two lists, because the live one must shrink and must never grow
 *
 *   `product-specific.allowlist.json` (beside this file) is the LIVE list. It
 *   must equal the measurement exactly: an unlisted hit is a new
 *   product-specific surface, and a listed entry the tree no longer has is
 *   stale — delete it. Deleting is the only edit it takes, and the stale half
 *   is what makes it shrink as product pages migrate out.
 *
 *   ADR-0060's "Frozen baseline" block is the CEILING and the RULES — the
 *   product words, the frozen directories and the frozen namespaces. Every
 *   live entry must be in the ceiling. The ADR is a governed surface, so the
 *   one way a new product-specific entry turns this file green is an ADR
 *   amendment the maintainer approves; appending to the live list alone stays
 *   red. The ceiling is this gate's INPUT, not a census of the tree: the
 *   census is what the code below derives.
 *
 * ## What it cannot see — said here so nobody reads green as more than it is
 *
 *   - A product surface under a neutral name outside the frozen directories (a
 *     `PaywallDialog` in `views/`). Names are all this reads; the pull-request
 *     template's checkbox and review are what catch the rest.
 *   - Growth INSIDE an existing file: the file half counts files, not lines.
 *   - Registration spellings `deriveRegistryKeys` reads under a premise that
 *     does not hold — the KNOWN GAP readings its own header enumerates. A
 *     spelling it does not RECOGNISE is a finding, and a finding reds this
 *     file rather than shrinking the population.
 *   - Re-adding something the live list already deleted: the ceiling keeps the
 *     entry until an ADR amendment drops it.
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtInLocales } from '@object-ui/i18n/locales';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { deriveRegistryKeys } from '../../../../scripts/check-doc-component-types.mjs';

/** Local annotation, since the import above is untyped — the call sites stay checked. */
type Finding = { reason: string; site: string; detail: string };
type Derivation = { keys: Map<string, string[]>; findings: Finding[] };
const derive: (
  root: string,
  options?: { indirectRegistrations?: unknown[]; openRegistrationSites?: unknown[] },
) => Derivation = deriveRegistryKeys;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

const ADR = 'docs/adr/0060-product-neutral-renderer.md';
const ADR_HEADING = '## Frozen baseline';
const ALLOWLIST = 'packages/app-shell/src/__tests__/product-specific.allowlist.json';

const REMEDY =
  'objectui is a product-neutral renderer (AGENTS.md › Product-neutral renderer, ADR-0060): ' +
  'compose the page from generic blocks, add a GENERIC block named for what it draws, or open a ' +
  'contract door in @objectstack/spec. ⛔ Do not add it to product-specific.allowlist.json — that ' +
  'list only shrinks, and ADR-0060’s ceiling refuses an entry it does not carry.';

// ── The two lists ────────────────────────────────────────────────────────────

interface Lists {
  registrations: string[];
  files: string[];
  i18n: Record<string, string[]>;
}
interface Ceiling extends Lists {
  productWords: string[];
  frozenDirectories: string[];
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/** The keys each list may carry; a misspelt key would otherwise read as an empty list. */
const LIST_KEYS = ['$comment', 'registrations', 'files', 'i18n'];
const CEILING_KEYS = [...LIST_KEYS, 'productWords', 'frozenDirectories'];

function assertLists(value: unknown, origin: string, allowed: readonly string[]): asserts value is Lists {
  const unknownKeys = Object.keys(value as object).filter((k) => !allowed.includes(k));
  if (unknownKeys.length > 0) throw new Error(`${origin}: unknown key(s) ${unknownKeys.join(', ')}`);
  const v = value as Partial<Lists>;
  if (!isStringArray(v.registrations) || !isStringArray(v.files)) {
    throw new Error(`${origin}: \`registrations\` and \`files\` must be string arrays`);
  }
  if (!v.i18n || typeof v.i18n !== 'object' || !Object.values(v.i18n).every(isStringArray)) {
    throw new Error(`${origin}: \`i18n\` must map each namespace to a string array of its keys`);
  }
}

/**
 * The ceiling: the one fenced `json` block under ADR-0060's frozen-baseline
 * heading. Read off the ADR rather than copied, so the governed text and the
 * gate's input are the same bytes.
 */
function readCeiling(): Ceiling {
  const lines = readFileSync(path.join(repoRoot, ADR), 'utf8').split('\n');
  const heading = lines.findIndex((l) => l.trim() === ADR_HEADING);
  if (heading === -1) throw new Error(`${ADR}: no \`${ADR_HEADING}\` heading`);
  const open = lines.findIndex((l, i) => i > heading && l.trim() === '```json');
  const close = lines.findIndex((l, i) => i > open && l.trim() === '```');
  if (open === -1 || close === -1) throw new Error(`${ADR}: no fenced json block under \`${ADR_HEADING}\``);
  const value = JSON.parse(lines.slice(open + 1, close).join('\n')) as Ceiling;
  assertLists(value, ADR, CEILING_KEYS);
  if (!isStringArray(value.productWords) || !isStringArray(value.frozenDirectories)) {
    throw new Error(`${ADR}: \`productWords\` and \`frozenDirectories\` must be string arrays`);
  }
  return value;
}

function readAllowlist(): Lists {
  const value = JSON.parse(readFileSync(path.join(repoRoot, ALLOWLIST), 'utf8')) as unknown;
  assertLists(value, ALLOWLIST, LIST_KEYS);
  return value;
}

const CEILING = readCeiling();
const LIVE = readAllowlist();
const WORDS = CEILING.productWords.map((w) => w.toLowerCase());

// ── The one predicate: does a name lead with a product word? ────────────────

/**
 * A name is product-named when a product word LEADS it, at a word boundary:
 * `cloud`, `cloud-connection`, `cloudOnboarding`, `CloudPlanStatus.tsx`,
 * `HotCRM`. A hook's `use` is skipped first, so `useCloudThing` leads with
 * `cloud` too. Leading, not anywhere: `word-cloud` names a chart, and
 * `cloudy` is not `cloud`.
 */
function leadsWithProductWord(name: string, words: readonly string[] = WORDS): boolean {
  const subject = /^use[A-Z]/.test(name) ? name.slice(3) : name;
  const lower = subject.toLowerCase();
  return words.some((word) => {
    if (!lower.startsWith(word)) return false;
    const next = subject.charAt(word.length);
    return next === '' || !/[a-z0-9]/.test(next);
  });
}

// ── The three measurements ───────────────────────────────────────────────────

function productRegistrations(root: string): { keys: Map<string, string[]>; findings: Finding[] } {
  const { keys, findings } = derive(root);
  const product = new Map<string, string[]>();
  for (const [key, sites] of keys) {
    if (key.split(':').some((segment) => leadsWithProductWord(segment))) product.set(key, sites);
  }
  return { keys: product, findings };
}

const SOURCE_ROOTS = ['packages', 'apps', 'examples'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'out', 'storybook-static']);
const TEST_DIRS = new Set(['__tests__', '__mocks__', '__fixtures__', '__benchmarks__', 'test', 'tests', 'e2e']);
const TEST_FILE = /\.(?:test|spec|stories)\.[cm]?[jt]sx?$/;

/**
 * A test adds no product surface — it is excluded from every published `dist`
 * — and a regression test on frozen code must stay writable until that code
 * migrates, so test paths are outside the file half (ADR-0060, "Frozen
 * directories").
 */
const isTestPath = (rel: string): boolean =>
  rel.split('/').some((segment) => TEST_DIRS.has(segment)) || TEST_FILE.test(rel);

function walk(dirRel: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(path.join(repoRoot, dirRel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const rel = `${dirRel}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
}

const ALL_FILES = (() => {
  const out: string[] = [];
  for (const root of SOURCE_ROOTS) walk(root, out);
  return out.sort();
})();

function productFiles(): string[] {
  return ALL_FILES.filter((rel) => {
    if (isTestPath(rel)) return false;
    if (CEILING.frozenDirectories.some((dir) => rel.startsWith(`${dir}/`))) return true;
    return rel.split('/').some((segment) => leadsWithProductWord(segment));
  });
}

type Catalogue = Record<string, unknown>;
const isNode = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function leafKeys(node: unknown, prefix = '', out: string[] = []): string[] {
  if (!isNode(node)) return out;
  for (const [key, value] of Object.entries(node)) {
    const at = prefix ? `${prefix}.${key}` : key;
    if (isNode(value)) leafKeys(value, at, out);
    else out.push(at);
  }
  return out;
}

const nodeAt = (catalogue: Catalogue, dotted: string): unknown =>
  dotted.split('.').reduce<unknown>((node, key) => (isNode(node) ? node[key] : undefined), catalogue);

/** Every key path, at any depth, whose own name leads with a product word and no frozen namespace holds. */
function productNamedKeysOutsideFrozen(catalogue: Catalogue): string[] {
  const frozen = Object.keys(CEILING.i18n);
  const out: string[] = [];
  const visit = (node: unknown, prefix: string) => {
    if (!isNode(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const at = prefix ? `${prefix}.${key}` : key;
      const held = frozen.some((ns) => at === ns || at.startsWith(`${ns}.`));
      if (held) continue;
      if (leadsWithProductWord(key)) out.push(at);
      visit(value, at);
    }
  };
  visit(catalogue, '');
  return out;
}

const LOCALES = Object.entries(builtInLocales as unknown as Record<string, Catalogue>);

// ── Helpers for the verdict text ─────────────────────────────────────────────

const minus = (a: readonly string[], b: readonly string[]) => {
  const drop = new Set(b);
  return [...new Set(a)].filter((x) => !drop.has(x)).sort();
};

// ── The pins ─────────────────────────────────────────────────────────────────

describe('product-neutral renderer ratchet (ADR-0060)', () => {
  describe('the lists themselves', () => {
    it('the ceiling declares product words and frozen directories — an empty rule set would pass everything', () => {
      expect(WORDS.length).toBeGreaterThan(0);
      expect(CEILING.frozenDirectories.length).toBeGreaterThan(0);
      expect(Object.keys(CEILING.i18n).length).toBeGreaterThan(0);
    });

    it('every live entry is inside ADR-0060’s ceiling — the live list takes deletions only', () => {
      const grown: string[] = [
        ...minus(LIVE.registrations, CEILING.registrations).map((k) => `registration ${k}`),
        ...minus(LIVE.files, CEILING.files).map((f) => `file ${f}`),
      ];
      for (const [ns, keys] of Object.entries(LIVE.i18n)) {
        if (!(ns in CEILING.i18n)) {
          grown.push(`i18n namespace ${ns}`);
          continue;
        }
        grown.push(...minus(keys, CEILING.i18n[ns]).map((k) => `i18n ${ns}.${k}`));
      }
      expect(
        grown,
        `${ALLOWLIST} carries entries ADR-0060's frozen baseline does not. The live list is edited only to ` +
          `DELETE; a new product-specific entry is an amendment to ADR-0060 that the maintainer approves. ${REMEDY}`,
      ).toEqual([]);
    });
  });

  describe('registrations', () => {
    const measured = productRegistrations(repoRoot);

    it('the registration derivation recognised every call it read — an unread spelling would shrink the population silently', () => {
      expect(measured.findings.map((f) => `${f.reason} at ${f.site}: ${f.detail}`)).toEqual([]);
    });

    it('no registry key leads with a product word unless the live list carries it', () => {
      const added = minus([...measured.keys.keys()], LIVE.registrations).map(
        (key) => `${key} (registered at ${measured.keys.get(key)!.join(', ')})`,
      );
      expect(added, `new product-named registry key(s). ${REMEDY}`).toEqual([]);
    });

    it('every listed registration still exists — a migrated one is deleted from the live list', () => {
      expect(
        minus(LIVE.registrations, [...measured.keys.keys()]),
        `${ALLOWLIST} lists registrations the tree no longer has; delete them (the list shrinks as pages migrate).`,
      ).toEqual([]);
    });

    it('CONTROL — the reader sees BOTH spellings of a product registration', () => {
      // A synthetic tree, so this keeps proving the namespace half after every
      // product widget in the real tree has migrated away.
      const root = mkdtempSync(path.join(tmpdir(), 'product-neutral-'));
      try {
        mkdirSync(path.join(root, 'packages/probe/src'), { recursive: true });
        writeFileSync(
          path.join(root, 'packages/probe/src/probe.tsx'),
          [
            "ComponentRegistry.register('cloud:literal-probe', () => null);",
            "ComponentRegistry.register('namespaced-probe', () => null, { namespace: 'cloud', skipFallback: true });",
            "ComponentRegistry.register('word-cloud', () => null);",
            '',
          ].join('\n'),
        );
        const { keys, findings } = derive(root, { indirectRegistrations: [], openRegistrationSites: [] });
        expect(findings).toEqual([]);
        expect([...keys.keys()].sort()).toEqual(['cloud:literal-probe', 'cloud:namespaced-probe', 'word-cloud']);
        expect([...keys.keys()].filter((k) => k.split(':').some((s) => leadsWithProductWord(s))).sort()).toEqual([
          'cloud:literal-probe',
          'cloud:namespaced-probe',
        ]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('files', () => {
    const measured = productFiles();

    it('the walk reached the source roots — a walk of nothing would pass everything', () => {
      expect(ALL_FILES.length).toBeGreaterThan(1000);
      expect(ALL_FILES).toContain('packages/app-shell/src/__tests__/product-neutral-renderer.ratchet.test.ts');
    });

    it('no file is added under a frozen directory, or named for a product, unless the live list carries it', () => {
      expect(minus(measured, LIVE.files), `new product-specific file(s). ${REMEDY}`).toEqual([]);
    });

    it('every listed file still exists — a migrated one is deleted from the live list', () => {
      expect(
        minus(LIVE.files, measured),
        `${ALLOWLIST} lists files the tree no longer has (or no longer counts); delete them.`,
      ).toEqual([]);
    });
  });

  describe('locale catalogues', () => {
    it('every built-in locale is read', () => {
      expect(LOCALES.map(([code]) => code)).toContain('en');
      expect(LOCALES.length).toBeGreaterThanOrEqual(10);
    });

    it.each(LOCALES)('%s: no key is added under a frozen namespace unless the live list carries it', (code, catalogue) => {
      const added: string[] = [];
      for (const ns of Object.keys(CEILING.i18n)) {
        const allowed = LIVE.i18n[ns] ?? [];
        added.push(...minus(leafKeys(nodeAt(catalogue, ns)), allowed).map((k) => `${ns}.${k}`));
      }
      expect(added, `new key(s) under a frozen product namespace in the ${code} catalogue. ${REMEDY}`).toEqual([]);
    });

    it.each(LOCALES)('%s: no key outside the frozen namespaces leads with a product word', (code, catalogue) => {
      expect(
        productNamedKeysOutsideFrozen(catalogue),
        `product-named i18n key(s) in the ${code} catalogue. ${REMEDY}`,
      ).toEqual([]);
    });

    it('every listed key still exists in some locale — a migrated one is deleted from the live list', () => {
      const stale: string[] = [];
      for (const [ns, keys] of Object.entries(LIVE.i18n)) {
        const present = new Set(LOCALES.flatMap(([, catalogue]) => leafKeys(nodeAt(catalogue, ns))));
        stale.push(...keys.filter((k) => !present.has(k)).map((k) => `${ns}.${k}`));
      }
      expect(stale, `${ALLOWLIST} lists i18n keys no locale has any more; delete them.`).toEqual([]);
    });
  });

  it('CONTROL — the product-word predicate', () => {
    for (const name of ['cloud', 'cloud-connection', 'cloudOnboarding', 'CloudPlanStatus.tsx', 'cloud.ts', 'useCloudThing', 'hotcrm-deals', 'HotCRM']) {
      expect(leadsWithProductWord(name, ['cloud', 'hotcrm']), name).toBe(true);
    }
    for (const name of ['word-cloud', 'cloudy', 'clouds', 'onboarding', 'user', 'useCloudy', 'hotcrmx']) {
      expect(leadsWithProductWord(name, ['cloud', 'hotcrm']), name).toBe(false);
    }
  });
});
