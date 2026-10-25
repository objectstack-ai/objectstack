/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7181 — every template `Object UI: Create New Schema` writes spells
 * its child lists `children`.
 *
 * ## Why this pin exists
 *
 * `getTemplateSchema` is a PRODUCER, and the tightest one in the repo: the
 * command writes the template to a `.objectui.json` file on disk and opens it,
 * and the extension's OWN preview and validator then read that same file. Every
 * template it shipped spelled its child lists `body`.
 *
 * That made the round trip self-contradicting in both directions at once. While
 * the readers were `body`-only, migrating the templates alone would have made
 * `Create New Schema` followed by `Open Preview` render blank. Now that the
 * readers honour `children` (see `body-dialect-children-arm-7181.test.ts`),
 * nothing but this pin would notice a template drifting back to `body`, or a
 * newly added template arriving in the old spelling.
 *
 * ## Why the function is transpiled rather than imported
 *
 * `getTemplateSchema` is module-local, and `extension.ts` imports `vscode`,
 * which has no runtime module outside the extension host and no alias in this
 * repo's vitest config. The file is therefore transpiled and executed against a
 * stub, and the function is taken out of the module scope by name. ⚠️ The
 * SOURCE file is never modified — only the in-memory transpiled copy is given a
 * trailing `return`, so this pin cannot drift from the shipped text.
 *
 * ## The template population is DERIVED, never listed here
 *
 * The names come from the quick-pick list `createNewSchema` offers, read out of
 * the source, so a template added tomorrow is covered today (AGENTS.md #9).
 * ⚠️ `getTemplateSchema` falls back to `empty` for an unknown name, so a pin
 * that guessed names would pass on every typo while testing one template three
 * times — the discovery below is checked against the template map itself.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const EXTENSION_SOURCE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../extension.ts'),
  'utf8'
);

/**
 * Transpile `extension.ts` against a `vscode` stub and hand back the
 * module-local `getTemplateSchema`.
 */
function loadShippedTemplateFactory(): (type: string) => string {
  const transpiled = ts.transpileModule(EXTENSION_SOURCE, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  // A stub that answers any member access with something callable, newable and
  // further-accessible. `getTemplateSchema` touches none of it; this only has
  // to survive module evaluation, which constructs nothing (`activate()` is
  // never called here).
  const inertStub: unknown = new Proxy(
    function stub() {} as unknown as object,
    {
      get: () => inertStub,
      apply: () => undefined,
      construct: () => ({}),
    }
  );

  const moduleShim = { exports: {} as Record<string, unknown> };
  const factory = new Function(
    'require',
    'module',
    'exports',
    `${transpiled}\nreturn typeof getTemplateSchema === 'function' ? getTemplateSchema : undefined;`
  )(
    (specifier: string) => {
      // `vscode` and the extension's own sibling modules are stubbed; a NEW
      // third-party dependency still throws, so this stays a real guard rather
      // than a catch-all.
      if (specifier === 'vscode' || specifier.startsWith('.')) return inertStub;
      throw new Error(`unexpected require("${specifier}") in extension.ts`);
    },
    moduleShim,
    moduleShim.exports
  );

  expect(
    typeof factory,
    'getTemplateSchema was not found in the transpiled extension module — ' +
      'it was renamed or moved, and this pin is measuring nothing'
  ).toBe('function');

  return factory as (type: string) => string;
}

/** The template names `createNewSchema` offers in its quick pick. */
function discoverTemplateNames(): string[] {
  const names = [...EXTENSION_SOURCE.matchAll(/\{\s*label:\s*'[^']+',\s*value:\s*'([^']+)'\s*\}/g)]
    .map((match) => match[1]);

  expect(
    names.length,
    'no template names discovered in createNewSchema\'s quick-pick list — ' +
      'the list moved and this pin would silently cover nothing'
  ).toBeGreaterThan(0);
  return names;
}

interface DialectTally {
  body: number;
  children: number;
  nodes: number;
}

function tallyDialect(value: unknown, tally: DialectTally): DialectTally {
  if (Array.isArray(value)) {
    value.forEach((entry) => tallyDialect(entry, tally));
    return tally;
  }
  if (!value || typeof value !== 'object') return tally;

  const node = value as Record<string, unknown>;
  if (typeof node.type === 'string') tally.nodes += 1;
  if ('body' in node) tally.body += 1;
  if ('children' in node) tally.children += 1;

  Object.values(node).forEach((entry) => tallyDialect(entry, tally));
  return tally;
}

describe('objectui#7181 — the VS Code new-schema templates use `children`', () => {
  const getTemplateSchema = loadShippedTemplateFactory();
  const templateNames = discoverTemplateNames();

  it.each(templateNames)(
    'template "%s" emits no `body` child list anywhere',
    (templateName) => {
      const raw = getTemplateSchema(templateName);
      let parsed: unknown;
      expect(
        () => {
          parsed = JSON.parse(raw);
        },
        `template "${templateName}" is not parseable JSON`
      ).not.toThrow();

      const tally = tallyDialect(parsed, { body: 0, children: 0, nodes: 0 });

      // Lit controls: without these the zero below could come from an empty
      // template or a walk that visited nothing.
      expect(
        tally.nodes,
        `template "${templateName}": the walk visited no typed node`
      ).toBeGreaterThan(0);
      expect(
        tally.children,
        `template "${templateName}": no node spells \`children\``
      ).toBeGreaterThan(0);

      expect(
        tally.body,
        `template "${templateName}" still emits the retired \`body\` child-list dialect`
      ).toBe(0);
    }
  );

  it('offers templates that are distinct documents, not the `empty` fallback repeated', () => {
    // `getTemplateSchema` returns `templates.empty` for any unknown name, so a
    // discovery that drifted out of sync with the template map would test one
    // template N times and still be green. Distinctness is what detects that.
    const rendered = templateNames.map((name) => getTemplateSchema(name));
    const distinct = new Set(rendered);

    expect(
      distinct.size,
      'every offered template rendered the same document — the quick-pick ' +
        'names no longer match the keys of the template map'
    ).toBeGreaterThan(1);
  });
});
