/**
 * The `timesheet` namespace: its shape, and how it sits beside the packs — the
 * properties `developer-namespace.test.ts` holds for the `developer` namespace.
 *
 *   1. LAZY BY CONSTRUCTION. `namespaces/timesheet/index.ts` reaches its
 *      catalogues through one literal `import()` each and nothing else, so each
 *      is a chunk of its own and none is in the console's first load.
 *   2. KEPT OUT OF THE PACKS. Every catalogue holds exactly the `timesheet`
 *      group, and no pack holds it.
 *   3. THE ALL-PACKS DOOR IS COMPLETE. `locales/index.ts` hands out each
 *      language as its pack merged with its catalogue; the package entry's
 *      `en` is the resident pack alone.
 *   4. THE LOADER refuses a language it ships nothing for and memoises a load.
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
import enNs from '../namespaces/timesheet/en.js';
import zhHansNs from '../namespaces/timesheet/zh-Hans.js';
import zhHantNs from '../namespaces/timesheet/zh-Hant.js';
import jaNs from '../namespaces/timesheet/ja.js';
import koNs from '../namespaces/timesheet/ko.js';
import deNs from '../namespaces/timesheet/de.js';
import frNs from '../namespaces/timesheet/fr.js';
import esNs from '../namespaces/timesheet/es.js';
import ptBrNs from '../namespaces/timesheet/pt-BR.js';
import ruNs from '../namespaces/timesheet/ru.js';
import arNs from '../namespaces/timesheet/ar.js';
import {
  TIMESHEET_LANGUAGE_CODES,
  TIMESHEET_NAMESPACE,
  TIMESHEET_NAMESPACE_PROBE_KEY,
  isTimesheetCatalogueLoaded,
  loadTimesheetCatalogue,
} from '../namespaces/timesheet/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(HERE, '..', 'namespaces', 'timesheet', 'index.ts');

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

describe('timesheet namespace — lazy by construction', () => {
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
    expect([...TIMESHEET_LANGUAGE_CODES].sort()).toEqual([...BUILT_IN_LANGUAGE_CODES].sort());
  });
});

describe('timesheet namespace — kept out of the packs', () => {
  it.each(BUILT_IN_LANGUAGE_CODES.map((code) => [code]))('%s: the catalogue holds the timesheet group only', (code) => {
    const catalogue = CATALOGUES[code];
    expect(Object.keys(catalogue)).toEqual([TIMESHEET_NAMESPACE]);
    expect(typeof lookup(catalogue, TIMESHEET_NAMESPACE_PROBE_KEY)).toBe('string');
  });

  it.each(BUILT_IN_LANGUAGE_CODES.map((code) => [code]))('%s: no pack holds the group', (code) => {
    expect(lookup(PACKS[code], TIMESHEET_NAMESPACE)).toBeUndefined();
    // Lit control: the pack itself is there.
    expect(typeof lookup(PACKS[code], 'console.errors.tryAgain')).toBe('string');
  });

  it.each(BUILT_IN_LANGUAGE_CODES.map((code) => [code]))('%s: the same leaves as the en catalogue', (code) => {
    expect(leaves(CATALOGUES[code]).sort()).toEqual(leaves(enNs).sort());
  });
});

describe('timesheet namespace — the all-packs door hands out complete languages', () => {
  it.each(BUILT_IN_LANGUAGE_CODES.map((code) => [code]))('%s: pack keys and namespace keys are both there', (code) => {
    const complete = (builtInLocales as unknown as Record<string, Tree>)[code];
    expect(lookup(complete, TIMESHEET_NAMESPACE)).toEqual(lookup(CATALOGUES[code], TIMESHEET_NAMESPACE));
    expect(lookup(complete, 'console.errors.tryAgain')).toBe(lookup(PACKS[code], 'console.errors.tryAgain'));
  });

  it("the package entry's `en` is the resident pack alone", () => {
    expect(lookup(entryEn, TIMESHEET_NAMESPACE_PROBE_KEY)).toBeUndefined();
    expect(typeof lookup(entryEn, 'console.errors.somethingWentWrong')).toBe('string');
  });
});

describe('timesheet namespace — the loader', () => {
  it('refuses a code it ships no catalogue for', async () => {
    await expect(loadTimesheetCatalogue('tlh')).rejects.toThrow(/timesheet namespace ships no `tlh` catalogue/);
    expect(isTimesheetCatalogueLoaded('tlh')).toBe(false);
  });

  it('loads a catalogue once and answers the same object after', async () => {
    const first = await loadTimesheetCatalogue('fr');
    expect(lookup(first, TIMESHEET_NAMESPACE_PROBE_KEY)).toBe(lookup(frNs, TIMESHEET_NAMESPACE_PROBE_KEY));
    expect(isTimesheetCatalogueLoaded('fr')).toBe(true);
    await expect(loadTimesheetCatalogue('fr')).resolves.toBe(first);
  });
});
