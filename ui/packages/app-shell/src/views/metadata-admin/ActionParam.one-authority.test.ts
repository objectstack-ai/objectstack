// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **`ActionParam` has one authority, and app-shell does not redeclare it**
 * (objectui#6329).
 *
 * The name was declared THREE times, not twice as the card first counted:
 *
 *   1. `packages/types/src/ui-action.ts` — `export interface ActionParam`,
 *      derived from the spec's `ActionParamSchema` input and re-exported from
 *      the package barrel. This is the authority, and it already carries its
 *      own parity suite (`packages/types/src/__tests__/spec-derived-unions.test.ts`
 *      and `page-nav-misc-spec-parity.test.ts`).
 *   2. `views/metadata-admin/inspectors/ActionDefaultInspector.tsx` — a
 *      module-local `interface`, seven members plus `[k: string]: unknown`.
 *   3. `views/metadata-admin/previews/ActionPreview.tsx` — a module-local
 *      `interface`, ten members, no index signature.
 *
 * app-shell already imports the published name correctly elsewhere
 * (`src/utils/resolveActionParams.test.ts`), so 2 and 3 were shadows of a name
 * their own package reads by reference. Under the 2026-08-25 family ruling
 * 甲A1 — every exported name has exactly one authority — they are deleted, not
 * reconciled against each other.
 *
 * ## Why the census, and not a key-set assertion
 *
 * The obvious pin — "the type accepts exactly these keys" — is a BLIND
 * INSTRUMENT against declaration 2. `[k: string]: unknown` makes every string
 * a member, so `keyof` on that type is `string` and a key-set comparison
 * cannot fail whatever the file does. That is the same trap
 * `FlowNodeInspector.specKeys.test.tsx` records for `InspectorFlowNode`.
 *
 * Here the index signature GOES AWAY in the convergence rather than being
 * worked around, so the key-set half becomes live — but only against the
 * published type, which is unchanged by this card and therefore cannot fail
 * before it. The half that can fail before and pass after is the CENSUS: a
 * module-local declaration is invisible from outside its module (that is the
 * instrument hole objectui#5899 is about, and the reason
 * `scripts/__tests__/one-authority-per-exported-name-6273.test.ts` — whose
 * matcher requires `export` — is green on all three sites). Only source can
 * see it. So the census is the reverse-verified pin; the key-set, schema and
 * `I18nLabel` assertions below are DIRECTION guards, pinning that the
 * authority still holds every member the two shadows carried.
 *
 * ## Why an AST and not a grep
 *
 * This very file names `interface ActionParam` in prose, and the two converged
 * files each keep a comment saying why their local copy is gone. A text scan
 * reports violations that do not exist; the compiler sees a comment. The
 * comment-blindness control below proves the discriminator rather than
 * asserting it.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ActionParamSchema } from '@objectstack/spec/ui';
import type { ActionParam } from '@object-ui/types';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
/** `packages/app-shell/src` — this file sits at `src/views/metadata-admin/`. */
const APP_SHELL_SRC = path.resolve(THIS_DIR, '../..');
const REPO_ROOT = path.resolve(APP_SHELL_SRC, '../../..');
const PUBLISHED_AUTHORITY = path.join(REPO_ROOT, 'packages/types/src/ui-action.ts');

const NAME = 'ActionParam';

/**
 * Tests declare throwaway shapes and quote real declarations as fixture text
 * on purpose — this file does both. They are out of the population; they stay
 * fair game as matcher fixtures.
 */
const NOT_POPULATION = /(?:^|[\\/])__tests__[\\/]|\.(?:test|spec|stories)\.[cm]?tsx?$/;
const SOURCE_SUFFIX = /\.(?:[cm]?ts|tsx)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_SUFFIX.test(entry.name) && !NOT_POPULATION.test(full)) out.push(full);
  }
  return out;
}

interface Site {
  readonly rel: string;
  readonly line: number;
  readonly what: string;
}

const parse = (file: string, source: string): ts.SourceFile =>
  ts.createSourceFile(file, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TSX);

/**
 * Every site in `source` that DECLARES the name — `interface X`, `type X`,
 * `enum X`, exported or not. Import and export clauses are not declarations
 * and never match: they are how one authority reaches many files.
 */
function declarationSites(source: string, rel = '<memory>'): Site[] {
  const sourceFile = parse(rel, source);
  const sites: Site[] = [];
  const visit = (node: ts.Node): void => {
    const isDeclaration =
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) &&
      node.name.text === NAME;
    if (isDeclaration) {
      const kind = ts.isInterfaceDeclaration(node)
        ? 'interface'
        : ts.isTypeAliasDeclaration(node)
          ? 'type'
          : 'enum';
      sites.push({
        rel,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        what: `${kind} ${NAME}`,
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return sites;
}

/** Files that name `ActionParam` at all — the prefilter the AST walk runs on. */
function mentioningFiles(): { file: string; rel: string; source: string }[] {
  return walk(APP_SHELL_SRC)
    .map((file) => ({ file, rel: path.relative(REPO_ROOT, file), source: readFileSync(file, 'utf8') }))
    .filter(({ source }) => source.includes(NAME))
    .sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

/** Type-only or value imports of `ActionParam` from `@object-ui/types`. */
function importsFromTypes(source: string, rel: string): boolean {
  const sourceFile = parse(rel, source);
  let found = false;
  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== '@object-ui/types') return;
    const bindings = node.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) return;
    for (const element of bindings.elements) {
      if (element.name.text === NAME) found = true;
    }
  });
  return found;
}

const CONVERGED = [
  'packages/app-shell/src/views/metadata-admin/inspectors/ActionDefaultInspector.tsx',
  'packages/app-shell/src/views/metadata-admin/previews/ActionPreview.tsx',
];

describe('ActionParam — one authority (objectui#6329)', () => {
  // ── The census: the half that fails before the convergence ────────────────

  it('no file under app-shell/src declares ActionParam locally', () => {
    const sites = mentioningFiles().flatMap(({ rel, source }) => declarationSites(source, rel));
    expect(
      sites.map((s) => `${s.rel}:${s.line} — ${s.what}`),
      'app-shell must READ the published `ActionParam` from `@object-ui/types`, never redeclare it (objectui#6329)',
    ).toEqual([]);
  });

  it('both converged files import ActionParam from @object-ui/types', () => {
    const missing = CONVERGED.filter((rel) => {
      const source = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      return !importsFromTypes(source, rel);
    });
    expect(missing, 'deleting the local copy is only half the fix — the published name has to arrive').toEqual([]);
  });

  // ── Controls on the instrument itself ─────────────────────────────────────

  it('finds the one declaration that SHOULD exist (non-vacuity)', () => {
    const sites = declarationSites(readFileSync(PUBLISHED_AUTHORITY, 'utf8'), 'packages/types/src/ui-action.ts');
    expect(sites.map((s) => s.what)).toEqual([`interface ${NAME}`]);
  });

  it('is blind to prose and to re-exports, and not to declarations', () => {
    const quoted = [
      '/**', ' * The local copy is gone:', ' *   interface ActionParam { name?: string }', ' */',
      "import type { ActionParam } from '@object-ui/types';",
      "export type { ActionParam } from '@object-ui/types';",
      "const s = 'interface ActionParam {}';",
    ].join('\n');
    expect(declarationSites(quoted)).toEqual([]);
    expect(declarationSites('interface ActionParam { name?: string }').map((s) => s.what)).toEqual([
      `interface ${NAME}`,
    ]);
    expect(declarationSites('type ActionParam = { name?: string }').map((s) => s.what)).toEqual([`type ${NAME}`]);
  });

  it('the prefilter is not hiding the population', () => {
    const rels = mentioningFiles().map((f) => f.rel);
    for (const rel of CONVERGED) expect(rels).toContain(rel);
  });

  // ── Direction guards on the surviving authority ───────────────────────────

  it('carries every member the two deleted shadows declared, with no index signature', () => {
    // `[k: string]: unknown` would make `string extends keyof ActionParam`
    // true, and every key-set assertion below vacuous. This is the blind
    // instrument the inspector's copy was, asserted away.
    const noIndexSignature: string extends keyof ActionParam ? false : true = true;
    expect(noIndexSignature).toBe(true);

    type ShadowMembers =
      | 'name' | 'field' | 'label' | 'type' | 'required'
      | 'options' | 'placeholder' | 'helpText' | 'defaultValue' | 'defaultFromRow';
    type Missing = Exclude<ShadowMembers, keyof ActionParam>;
    const noMemberLost: [Missing] extends [never] ? true : false = true;
    expect(noMemberLost).toBe(true);
  });

  it('refuses a key the inspector shadow admitted through its index signature', () => {
    // `referenceTo` is the resolved-side spelling `ui-action.ts` documents as
    // the silent authoring error: `[k: string]: unknown` typed it `unknown`
    // and let it through, while the strict schema rejects it BY NAME.
    // @ts-expect-error — not an authorable `ActionParam` key
    const refused: ActionParam = { name: 'account_id', referenceTo: 'account' };
    expect(refused.name).toBe('account_id');

    const parsed = ActionParamSchema.safeParse({ name: 'account_id', referenceTo: 'account' });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues ?? [])).toContain('referenceTo');
  });

  it('what the shadows described still parses clean through the real strict schema', () => {
    const param = {
      name: 'reason',
      field: 'reason',
      label: 'Reason',
      type: 'select',
      required: true,
      options: [{ label: 'Duplicate', value: 'dup' }],
      placeholder: 'Why?',
      helpText: 'Shown under the input.',
      defaultValue: 'dup',
      defaultFromRow: false,
    } satisfies ActionParam;
    const parsed = ActionParamSchema.safeParse(param);
    expect(JSON.stringify(parsed.error?.issues ?? [])).toBe('[]');
    expect(parsed.success).toBe(true);
  });

  it('accepts BOTH authorized I18nLabel forms — the preview shadow admitted only `en`', () => {
    // The preview's copy said `string | { en?: string }`. Its own `localize`
    // helper has always read `Object.values(o)[0]`, so an inline locale map
    // keyed by any tag already rendered; only the declaration was narrower
    // than the code. Converging widens the TYPE onto what the runtime does,
    // it does not widen what the runtime accepts.
    const plain = { name: 'p', label: 'Reason' } satisfies ActionParam;
    const localeMap = { name: 'p', label: { en: 'Reason', 'fr-FR': 'Motif' } } satisfies ActionParam;
    for (const param of [plain, localeMap]) {
      expect(ActionParamSchema.safeParse(param).success).toBe(true);
    }
  });
});
