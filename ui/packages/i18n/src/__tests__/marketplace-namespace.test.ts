/**
 * The `marketplace` namespace (objectstack#30588): its shape, and how it sits
 * beside the ten packs it was cut out of.
 *
 *   1. LAZY BY CONSTRUCTION. `namespaces/marketplace/index.ts` reaches its ten
 *      catalogues through ten literal `import()`s and nothing else — no static
 *      import, no template-literal specifier — so each is a chunk of its own
 *      and none is in the console's first load.
 *   2. CUT, NOT COPIED. Every catalogue holds only the `marketplace` group and
 *      the probe key the page frame waits on; no pack holds the probe key, and
 *      no leaf is in both a pack and its catalogue.
 *   3. THE ALL-TEN DOOR IS COMPLETE. `locales/index.ts` hands out each language
 *      as its pack merged with its catalogue, so the parity suites that walk
 *      `builtInLocales` still walk these keys; the package entry's `en` is the
 *      resident pack alone.
 *   4. LANGUAGE RESOLUTION and the memoised loader.
 *
 * The runtime a page observes — loading, the fetch, the re-render, a switch, a
 * failure and its retry — is `marketplace-namespace-lazy.test.tsx`'s, in a DOM
 * project that isolates its module graph; this file runs in `unit`, which
 * shares one per worker, so "nothing fetched yet" is not a state it assumes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { en as entryEn } from '../index.js';
import { BUILT_IN_LANGUAGE_CODES } from '../locales/registry.js';
import { builtInLocales } from '../locales/index.js';
import enPack from '../locales/en.js';
import zhPack from '../locales/zh.js';
import jaPack from '../locales/ja.js';
import koPack from '../locales/ko.js';
import dePack from '../locales/de.js';
import frPack from '../locales/fr.js';
import esPack from '../locales/es.js';
import ptPack from '../locales/pt.js';
import ruPack from '../locales/ru.js';
import arPack from '../locales/ar.js';
import enNs from '../namespaces/marketplace/en.js';
import zhNs from '../namespaces/marketplace/zh.js';
import jaNs from '../namespaces/marketplace/ja.js';
import koNs from '../namespaces/marketplace/ko.js';
import deNs from '../namespaces/marketplace/de.js';
import frNs from '../namespaces/marketplace/fr.js';
import esNs from '../namespaces/marketplace/es.js';
import ptNs from '../namespaces/marketplace/pt.js';
import ruNs from '../namespaces/marketplace/ru.js';
import arNs from '../namespaces/marketplace/ar.js';
import {
  MARKETPLACE_LANGUAGE_CODES,
  MARKETPLACE_NAMESPACE,
  MARKETPLACE_NAMESPACE_PROBE_KEY,
  isMarketplaceCatalogueLoaded,
  loadMarketplaceCatalogue,
  resolveMarketplaceLanguage,
} from '../namespaces/marketplace/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(HERE, '..', 'namespaces', 'marketplace', 'index.ts');

type Tree = Record<string, unknown>;
const PACKS: Record<string, Tree> = {
  en: enPack, zh: zhPack, ja: jaPack, ko: koPack, de: dePack,
  fr: frPack, es: esPack, pt: ptPack, ru: ruPack, ar: arPack,
};
const CATALOGUES: Record<string, Tree> = {
  en: enNs, zh: zhNs, ja: jaNs, ko: koNs, de: deNs,
  fr: frNs, es: esNs, pt: ptNs, ru: ruNs, ar: arNs,
};

function leaves(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

function lookup(tree: unknown, path: string): unknown {
  let node: unknown = tree;
  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.prototype.hasOwnProperty.call(node, segment)) return undefined;
    node = (node as Tree)[segment];
  }
  return node;
}

describe('marketplace namespace — lazy by construction', () => {
  const source = readFileSync(INDEX_PATH, 'utf8');
  const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  const staticSpecifiers: string[] = [];
  const dynamicSpecifiers: string[] = [];
  const nonLiteralImports: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      staticSpecifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) dynamicSpecifiers.push(arg.text);
      else nonLiteralImports.push(node.getText(file));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  it('imports one literal `import()` per catalogue, one catalogue per built-in language', () => {
    expect([...dynamicSpecifiers].sort()).toEqual(BUILT_IN_LANGUAGE_CODES.map((code) => `./${code}.js`).sort());
    expect(nonLiteralImports).toEqual([]);
  });

  it('statically imports no catalogue (nothing of it rides in with the page frame)', () => {
    expect(staticSpecifiers.filter((s) => /^\.\/[a-z]{2}\.js$/.test(s))).toEqual([]);
    // Lit control: the static imports were read.
    expect(staticSpecifiers).toContain('../../locales/registry.js');
  });

  it('ships the ten built-in languages', () => {
    expect([...MARKETPLACE_LANGUAGE_CODES].sort()).toEqual([...BUILT_IN_LANGUAGE_CODES].sort());
  });
});

describe('marketplace namespace — cut out of the packs, not copied', () => {
  it.each(BUILT_IN_LANGUAGE_CODES.map((code) => [code]))('%s: the catalogue holds the marketplace group only', (code) => {
    expect(Object.keys(CATALOGUES[code])).toEqual([MARKETPLACE_NAMESPACE]);
  });

  it.each(BUILT_IN_LANGUAGE_CODES.map((code) => [code]))('%s: the probe key is in the catalogue and not in the pack', (code) => {
    expect(typeof lookup(CATALOGUES[code], MARKETPLACE_NAMESPACE_PROBE_KEY)).toBe('string');
    expect(lookup(PACKS[code], MARKETPLACE_NAMESPACE_PROBE_KEY)).toBeUndefined();
  });

  it.each(BUILT_IN_LANGUAGE_CODES.map((code) => [code]))('%s: no leaf is in both the pack and the catalogue', (code) => {
    const packLeaves = new Set(leaves(PACKS[code]));
    const nsLeaves = leaves(CATALOGUES[code]);
    // Lit controls: both halves of the marketplace group are populated.
    expect(nsLeaves.length).toBeGreaterThan(150);
    expect([...packLeaves].filter((k) => k.startsWith('marketplace.')).length).toBeGreaterThan(10);
    expect(nsLeaves.filter((key) => packLeaves.has(key))).toEqual([]);
  });
});

describe('marketplace namespace — the all-ten door hands out complete languages', () => {
  it.each(BUILT_IN_LANGUAGE_CODES.map((code) => [code]))('%s: pack keys and namespace keys are both there', (code) => {
    const complete = (builtInLocales as unknown as Record<string, Tree>)[code];
    const expected = [...leaves(PACKS[code]), ...leaves(CATALOGUES[code])].sort();
    expect(leaves(complete).sort()).toEqual(expected);
    expect(lookup(complete, MARKETPLACE_NAMESPACE_PROBE_KEY)).toBe(lookup(CATALOGUES[code], MARKETPLACE_NAMESPACE_PROBE_KEY));
    // A family Studio's packages page reads, still served from the pack.
    expect(lookup(complete, 'marketplace.action.uninstall')).toBe(lookup(PACKS[code], 'marketplace.action.uninstall'));
  });

  it("the package entry's `en` is the resident pack alone", () => {
    expect(lookup(entryEn, MARKETPLACE_NAMESPACE_PROBE_KEY)).toBeUndefined();
    expect(typeof lookup(entryEn, 'marketplace.install.dependencyMissing.heading')).toBe('string');
  });
});

describe('marketplace namespace — language resolution and the loader', () => {
  it.each([
    ['zh-CN', 'zh'],
    ['zh', 'zh'],
    ['zh-TW', 'zh'],
    ['pt-BR', 'pt'],
    ['ar-EG', 'ar'],
    ['en-US', 'en'],
    ['de', 'de'],
    ['sv', null],
    ['', null],
    [undefined, null],
  ])('%s is served by the %s catalogue', (lang, code) => {
    expect(resolveMarketplaceLanguage(lang)).toBe(code);
  });

  it('refuses a code it ships no catalogue for', async () => {
    await expect(loadMarketplaceCatalogue('tlh')).rejects.toThrow(/ships no `tlh` catalogue/);
    expect(isMarketplaceCatalogueLoaded('tlh')).toBe(false);
  });

  it('loads a catalogue once and answers the same object after', async () => {
    const first = await loadMarketplaceCatalogue('de');
    expect(lookup(first, MARKETPLACE_NAMESPACE_PROBE_KEY)).toBe(lookup(deNs, MARKETPLACE_NAMESPACE_PROBE_KEY));
    expect(isMarketplaceCatalogueLoaded('de')).toBe(true);
    await expect(loadMarketplaceCatalogue('de')).resolves.toBe(first);
  });
});
