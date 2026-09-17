// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18607] Every `client.packages.install(<manifest>)` example in THIS
 * package's PUBLISHED README is parsed against the contract that door
 * declares — `PackageInstallRequestSchema`, whose `manifest` key is
 * `ManifestSchema`.
 *
 * ## The defect it exists to prevent
 *
 * The README shipped this manifest in the npm tarball:
 *
 *     await client.packages.install({
 *       name: 'vendor_plugin',
 *       label: 'Vendor Plugin',
 *       version: '1.0.0',
 *     });
 *
 * Parsed against the declared contract it is refused on THREE counts:
 * `invalid_type` at `[manifest, id]`, `invalid_value` at `[manifest, type]`
 * (both keys are required and absent), and `unrecognized_keys` at
 * `[manifest]` for `label` — a key `ManifestSchema`'s `strictObject` close
 * refuses BY NAME. `label` is not a root manifest key and never was: the
 * root shape declares `name` for the human-readable string, and the only
 * `label` anywhere near this surface belonged to the nested, since-RETIRED
 * `contributes.themes` `{ id, label, path }` entry — a sibling shape, not
 * this one.
 *
 * Nothing parses the contract at that door today, so the example "worked":
 * the SDK posts whatever literal it is handed, and `install(manifest: any)`
 * type-checks it away. That is what made this a timed charge rather than a
 * live outage — closing the door turns a silently-wrong published example
 * into a loudly-broken one for every reader who copied it.
 *
 * ## Why a pin, and why this one CAN fail
 *
 * Nothing else reads these literals. `check:published-readme-exports` has
 * the right population but reads fenced blocks for IMPORTED SYMBOLS and has
 * no notion of a schema; no gate parses an example payload against the
 * schema its own call site declares. Restore any of the three original
 * defects and this test reds on that specific issue code.
 *
 * Two shapes deliberately fail rather than pass quietly, because a pin that
 * measures nothing is worse than none (Route & surface ownership §3):
 * the corpus going EMPTY (the anchor renamed, the fence relabelled) and a
 * literal carrying a node kind the reader does not model.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PackageInstallRequestSchema } from '@objectstack/spec/api';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** This package's own published README — inside the package, no escape. */
const README = fileURLToPath(new URL('../README.md', import.meta.url));

/** The call whose first argument IS the manifest. */
const INSTALL_CALL = 'packages.install';

/** ```ts / ```typescript fences — the only regions read as code. */
const TS_FENCE = /^```(?:ts|typescript)\s*$\n([\s\S]*?)^```\s*$/gm;

/**
 * An object literal, as a value. ⛔ Never a partial read: an unmodelled node
 * kind throws, because a manifest quietly missing the key that carried the
 * defect would parse green and pin nothing.
 */
function literalToValue(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literalToValue);
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        throw new Error(`Unmodelled object member in a README manifest: ${ts.SyntaxKind[prop.kind]}`);
      }
      const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
        ? prop.name.text
        : undefined;
      if (key === undefined) {
        throw new Error(`Unmodelled property name in a README manifest: ${ts.SyntaxKind[prop.name.kind]}`);
      }
      out[key] = literalToValue(prop.initializer);
    }
    return out;
  }
  throw new Error(`Unmodelled expression in a README manifest: ${ts.SyntaxKind[node.kind]}`);
}

interface InstallExample {
  /** 1-based line of the call inside the README, for the failure message. */
  readonly line: number;
  readonly manifest: unknown;
  readonly source: string;
}

function collectInstallExamples(readme: string): InstallExample[] {
  const found: InstallExample[] = [];
  for (const fence of readme.matchAll(TS_FENCE)) {
    const code = fence[1] ?? '';
    const fenceLine = readme.slice(0, fence.index ?? 0).split('\n').length;
    const sourceFile = ts.createSourceFile('readme-fence.ts', code, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node)
        && node.expression.getText(sourceFile).endsWith(INSTALL_CALL)
        && node.arguments.length > 0
      ) {
        const [first] = node.arguments;
        if (first !== undefined && ts.isObjectLiteralExpression(first)) {
          found.push({
            line: fenceLine + sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line,
            manifest: literalToValue(first),
            source: first.getText(sourceFile),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return found;
}

const EXAMPLES = collectInstallExamples(readFileSync(README, 'utf8'));

describe('published README — packages.install examples parse as manifests', () => {
  it('finds at least one `packages.install` manifest literal to judge', () => {
    // Anti-vacuity floor. An empty corpus means the anchor moved, not that
    // every example is correct.
    expect(EXAMPLES.length).toBeGreaterThan(0);
  });

  it.each(EXAMPLES.map((e) => [e.line, e] as const))(
    'README line %i is accepted by PackageInstallRequestSchema',
    (_line, example) => {
      const result = PackageInstallRequestSchema.safeParse({ manifest: example.manifest });
      const refusals = result.success
        ? []
        : result.error.issues.map((issue) => `${issue.code} at [${issue.path.join(', ')}]`);
      expect(refusals, `${example.source}\n→ ${refusals.join('; ')}`).toEqual([]);
    },
  );
});
