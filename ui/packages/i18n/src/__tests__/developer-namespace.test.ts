/**
 * The `developer` namespace (objectstack#32225): its shape, and how it sits
 * beside the packs it was cut out of — the same four properties
 * `marketplace-namespace.test.ts` holds for the `marketplace` namespace.
 *
 *   1. LAZY BY CONSTRUCTION. `namespaces/developer/index.ts` reaches its
 *      catalogues through one literal `import()` each and nothing else, so each
 *      is a chunk of its own and none is in the console's first load.
 *   2. CUT, NOT COPIED. Every catalogue holds exactly the `console.developer`
 *      and `connectAgent` groups; no pack holds either any more, and no leaf is
 *      in both a pack and its catalogue.
 *   3. THE ALL-PACKS DOOR IS COMPLETE. `locales/index.ts` hands out each
 *      language as its pack merged with its catalogue; the package entry's
 *      `en` is the resident pack alone.
 *   4. THE LOADER answers from the registry when a host made every catalogue
 *      resident, and refuses a language it ships nothing for.
 *
 * The runtime a surface observes (loading, the fetch, a failure and its retry)
 * is app-shell's `DeveloperNamespaceGate-32225.test.tsx`'s, through the widgets
 * that read these keys; the shared runtime itself is
 * `marketplace-namespace-lazy.test.tsx`'s, since both namespaces are built by
 * `namespaces/packNamespace.ts`.
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
import zhHansPack from '../locales/zh-Hans.js';
import zhHantPack from '../locales/zh-Hant.js';
import jaPack from '../locales/ja.js';
import koPack from '../locales/ko.js';
import dePack from '../locales/de.js';
import frPack from '../locales/fr.js';
import esPack from '../locales/es.js';
import ptBrPack from '../locales/pt-BR.js';
import ruPack from '../locales/ru.js';
import arPack from '../locales/ar.js';
import enNs from '../namespaces/developer/en.js';
import zhHansNs from '../namespaces/developer/zh-Hans.js';
import zhHantNs from '../namespaces/developer/zh-Hant.js';
import jaNs from '../namespaces/developer/ja.js';
import koNs from '../namespaces/developer/ko.js';
import deNs from '../namespaces/developer/de.js';
import frNs from '../namespaces/developer/fr.js';
import esNs from '../namespaces/developer/es.js';
import ptBrNs from '../namespaces/developer/pt-BR.js';
import ruNs from '../namespaces/developer/ru.js';
import arNs from '../namespaces/developer/ar.js';
import {
  DEVELOPER_LANGUAGE_CODES,
  DEVELOPER_NAMESPACE_GROUPS,
  DEVELOPER_NAMESPACE_PROBE_KEY,
  isDeveloperCatalogueLoaded,
  loadDeveloperCatalogue,
} from '../namespaces/developer/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(HERE, '..', 'namespaces', 'developer', 'index.ts');

type Tree = Record<string, unknown>;
const PACKS: Record<string, Tree> = {
  en: enPack, 'zh-Hans': zhHansPack, 'zh-Hant': zhHantPack, ja: jaPack, ko: koPack, de: dePack,
  fr: frPack, es: esPack, 'pt-BR': ptBrPack, ru: ruPack, ar: arPack,
};
const CATALOGUES: Record<string, Tree> = {
  en: enNs, 'zh-Hans': zhHansNs, 'zh-Hant': zhHantNs, ja: jaNs, ko: koNs, de: deNs,
  fr: frNs, es: esNs, 'pt-BR': ptBrNs, ru: ruNs, ar: arNs,
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

describe('developer namespace — lazy by construction', () => {
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

  it('statically imports no catalogue, and builds on the one pack-namespace loader', () => {
    expect(staticSpecifiers.filter((s) => /^\.\/[a-z]{2}(?:-[A-Za-z]+)?\.js$/.test(s))).toEqual([]);
    // Lit control, and the "no second loader" half: the runtime is the shared one.
    expect(staticSpecifiers).toContain('../packNamespace.js');
  });

  it('ships one catalogue per built-in language (the platform locale table)', () => {
    expect([...DEVELOPER_LANGUAGE_CODES].sort()).toEqual([...BUILT_IN_LANGUAGE_CODES].sort());
  });
});

describe('developer namespace — cut out of the packs, not copied', () => {
  it.each(BUILT_IN_LANGUAGE_CODES.map((code) => [code]))('%s: the catalogue holds the two moved groups only', (code) => {
    const catalogue = CATALOGUES[code];
    expect(Object.keys(catalogue).sort()).toEqual(['connectAgent', 'console']);
    expect(Object.keys(catalogue.console as Tree)).toEqual(['developer']);
    for (const group of DEVELOPER_NAMESPACE_GROUPS) expect(typeof lookup(catalogue, group)).toBe('object');
  });

  it.each(BUILT_IN_LANGUAGE_CODES.map((code) => [code]))('%s: no pack holds either group any more', (code) => {
    for (const group of DEVELOPER_NAMESPACE_GROUPS) expect(lookup(PACKS[code], group)).toBeUndefined();
    expect(typeof lookup(CATALOGUES[code], DEVELOPER_NAMESPACE_PROBE_KEY)).toBe('string');
    // Lit control: the pack's other `console` groups are still there.
    expect(typeof lookup(PACKS[code], 'console.errors.tryAgain')).toBe('string');
  });

  it('the en catalogue is populated (key parity across languages is all-locales-key-parity\'s)', () => {
    expect(leaves(enNs).length).toBeGreaterThan(200);
  });
});

describe('developer namespace — the all-packs door hands out complete languages', () => {
  it.each(BUILT_IN_LANGUAGE_CODES.map((code) => [code]))('%s: pack keys and namespace keys are both there', (code) => {
    const complete = (builtInLocales as unknown as Record<string, Tree>)[code];
    for (const group of DEVELOPER_NAMESPACE_GROUPS) {
      expect(lookup(complete, group)).toEqual(lookup(CATALOGUES[code], group));
    }
    expect(lookup(complete, 'console.errors.tryAgain')).toBe(lookup(PACKS[code], 'console.errors.tryAgain'));
  });

  it("the package entry's `en` is the resident pack alone", () => {
    expect(lookup(entryEn, DEVELOPER_NAMESPACE_PROBE_KEY)).toBeUndefined();
    expect(lookup(entryEn, 'console.developer')).toBeUndefined();
    expect(typeof lookup(entryEn, 'console.errors.somethingWentWrong')).toBe('string');
  });
});

describe('developer namespace — the loader', () => {
  it('refuses a code it ships no catalogue for', async () => {
    await expect(loadDeveloperCatalogue('tlh')).rejects.toThrow(/developer namespace ships no `tlh` catalogue/);
    expect(isDeveloperCatalogueLoaded('tlh')).toBe(false);
  });

  it('loads a catalogue once and answers the same object after', async () => {
    const first = await loadDeveloperCatalogue('fr');
    expect(lookup(first, DEVELOPER_NAMESPACE_PROBE_KEY)).toBe(lookup(frNs, DEVELOPER_NAMESPACE_PROBE_KEY));
    expect(isDeveloperCatalogueLoaded('fr')).toBe(true);
    await expect(loadDeveloperCatalogue('fr')).resolves.toBe(first);
  });
});
