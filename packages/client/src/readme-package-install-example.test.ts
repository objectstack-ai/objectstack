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

import { PackageInstallBodySchema, PackageInstallRequestSchema } from '@objectstack/spec/api';
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

/**
 * [#18058] The same corpus, judged against the BODY the SDK actually PUTS ON
 * THE WIRE — and with a control that keeps the judgement from going vacuous.
 *
 * Two things the block above deliberately does not do, and this one does:
 *
 * 1. It parses `{ manifest }` alone. `packages.install` sends
 *    `{ manifest, settings, enableOnInstall, …overwrite }`, and the contract
 *    bound to the door is {@link PackageInstallBodySchema} — a union that also
 *    accepts a BARE manifest, which is how `POST /api/v1/packages` reads a body
 *    (`body.manifest || body`). Both shapes are asserted here, so a README
 *    example that parses only when wrapped cannot pass unnoticed.
 * 2. Its anti-vacuity floor is a COUNT — it proves the corpus is non-empty, not
 *    that the schema still refuses anything. The at-tier review of #18752
 *    measured exactly that gap the other way round: reverting this README left
 *    the hand-transcribed spec-side pin 56/56 green. The refusal control below
 *    is the other half: if the manifest contract is ever relaxed back to the
 *    pre-#18058 shape, this reds even while every README example still parses.
 */
describe('#18058 — the README examples parse as the BODY the SDK sends, and the pin can still fail', () => {
  /** `index.ts`'s `packages.install` body, spelled out. */
  const asTheSdkSends = (
    manifest: unknown,
    options?: { settings?: Record<string, unknown>; enableOnInstall?: boolean; overwrite?: boolean },
  ) => ({
    manifest,
    settings: options?.settings,
    enableOnInstall: options?.enableOnInstall,
    ...(options?.overwrite !== undefined ? { overwrite: options.overwrite } : {}),
  });

  it.each(EXAMPLES.map((e) => [e.line, e] as const))(
    'README line %i parses as the wrapped body the SDK sends',
    (_line, example) => {
      const verdict = PackageInstallBodySchema.safeParse(asTheSdkSends(example.manifest));
      expect(verdict.error?.issues ?? [], example.source).toEqual([]);
      expect(verdict.success).toBe(true);
    },
  );

  it.each(EXAMPLES.map((e) => [e.line, e] as const))(
    'README line %i parses BARE too — `body.manifest || body` is how the door reads it',
    (_line, example) => {
      expect(PackageInstallBodySchema.safeParse(example.manifest).success, example.source).toBe(true);
    },
  );

  it('the overwrite opt-in the README names beside the example parses', () => {
    const [first] = EXAMPLES;
    expect(first).toBeDefined();
    expect(PackageInstallBodySchema.safeParse(asTheSdkSends(first?.manifest, { overwrite: true })).success).toBe(true);
  });

  it('\u26d4 the pre-#18058 literal is still REFUSED — a schema relaxation cannot make this block vacuous', () => {
    // Exactly the text this README shipped: no `id`, no `type`, and `label`,
    // which `ManifestSchema`'s strict close refuses by name. If this turns
    // green the contract was relaxed, not the example fixed.
    const asShipped = { name: 'vendor_plugin', label: 'Vendor Plugin', version: '1.0.0' };
    expect(PackageInstallBodySchema.safeParse(asTheSdkSends(asShipped)).success).toBe(false);
    expect(PackageInstallBodySchema.safeParse(asShipped).success).toBe(false);
    expect(PackageInstallRequestSchema.safeParse({ manifest: asShipped }).success).toBe(false);
  });
});
