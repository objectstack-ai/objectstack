// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Fixture projects authored in the ONE legal shape (#20367 ruling B):
 * `export default defineStack({ … })`.
 *
 * `os validate` and `os build` refuse a default export no stack producer built
 * (`STACK_PROVENANCE_MISSING`), so a fixture that wants either door to judge its
 * CONTENT has to be built by `defineStack` — which means the fixture project has
 * to RESOLVE `@objectstack/spec`. An OS-tmpdir project cannot, so
 * {@link linkSpec} gives it a `node_modules/@objectstack/spec` symlink to the
 * package this one already depends on — the spelling `migrate-meta.e2e.test.ts`
 * and `generate-skill.e2e.test.ts` established. Resolved through
 * `node_modules` rather than by walking up from this file, so it is a package
 * specifier and not a cross-package source read.
 *
 * `strict: false` is for a fixture whose content is the DOOR's to judge — a
 * shape the strict producer would refuse at load, before the door runs
 * anything (a schema error the door's own parse must report, an unknown
 * `requires` token the capability preflight must render). The mark is the same
 * in both modes; only what `defineStack` itself refuses differs.
 */
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const SPEC_PACKAGE_ROOT = dirname(createRequire(import.meta.url).resolve('@objectstack/spec/package.json'));

/** Make `@objectstack/spec` resolvable from `dir` (idempotent). */
export function linkSpec(dir: string): void {
  const scope = join(dir, 'node_modules', '@objectstack');
  const link = join(scope, 'spec');
  if (existsSync(link)) return;
  mkdirSync(scope, { recursive: true });
  symlinkSync(SPEC_PACKAGE_ROOT, link, 'dir');
}

export interface DefineStackSourceOptions {
  /** Emit `defineStack(…, { strict: false })` — see the module header for when. */
  strict?: false;
}

/** The module source `export default defineStack(<stack>)`, from a JSON-able value. */
export function defineStackSource(stack: unknown, options: DefineStackSourceOptions = {}): string {
  return defineStackSourceFromLiteral(JSON.stringify(stack, null, 2), options);
}

/** The same, from an object-literal SOURCE string (for fixtures that carry functions). */
export function defineStackSourceFromLiteral(literal: string, options: DefineStackSourceOptions = {}): string {
  const trailer = options.strict === false ? ', { strict: false }' : '';
  return `import { defineStack } from '@objectstack/spec';\n\nexport default defineStack(${literal.trim()}${trailer});\n`;
}

/**
 * Write `<dir>/<file>` as a `defineStack` module over `stack` and link spec
 * into `dir`. `file` defaults to `objectstack.config.ts`.
 */
export function writeDefineStackConfig(
  dir: string,
  stack: unknown,
  options: DefineStackSourceOptions & { file?: string } = {},
): string {
  const file = join(dir, options.file ?? 'objectstack.config.ts');
  writeFileSync(file, defineStackSource(stack, options));
  linkSpec(dir);
  return file;
}
