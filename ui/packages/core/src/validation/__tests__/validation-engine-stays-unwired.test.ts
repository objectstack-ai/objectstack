/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectValidationEngine` stays unwired — the mechanism behind #3110.
 *
 * The decision was: validation rules are ENFORCEMENT, enforcement is
 * single-implementation on the server, and objectui renders the server's
 * rejection rather than predicting it. `evaluator/fieldRules.ts` draws the same
 * line for the presentation predicates it DOES evaluate client-side — it
 * delegates to the canonical `ExpressionEngine` "rather than re-implementing a
 * parallel evaluator" (ADR-0036). This engine is that parallel evaluator.
 *
 * #3103 converged it onto the server rule-for-rule and still left a known
 * divergence (ADR-0113's legacy-violation exemption), which is the whole
 * argument: mirroring cross-repo behaviour is structurally unreliable.
 *
 * Why a test and not just the `@deprecated` tag: the thing this replaced was a
 * doc comment claiming spec canonicity that had been false for fifteen majors
 * (#3103). Shipping the successor decision as another comment would repeat the
 * mistake one level up — a rule that is not a check is not a rule (#3017,
 * objectstack#4115). So the ban is compiled here: wire the engine into a
 * production module and this file names the file, the line, and the issue to
 * reverse first.
 *
 * This is deliberately a REACHABILITY ban, not a mention ban. Nothing stops a
 * host application from importing the deprecated engine — it is still exported,
 * still functional. What is banned is objectui itself growing a client-side
 * enforcement path again.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

/** `packages/` — three levels up from `packages/core/src/validation/__tests__`. */
const PACKAGES_DIR = resolve(__dirname, '../../../..');

/**
 * The engine's own module, its barrels, and its tests. A barrel re-export is not
 * a wiring: it publishes the deprecated API for host applications, which is
 * exactly what "deprecated but not removed" means.
 */
const ALLOWED = [
  'core/src/validation/validators/object-validation-engine.ts',
  'core/src/validation/validators/index.ts',
  'core/src/validation/index.ts',
];

/** The engine's module path, and the entry points a caller would name. */
const ENGINE_REFERENCE =
  /object-validation-engine|ObjectValidationEngine|defaultObjectValidationEngine/;

/**
 * Strip comments and string bodies before looking for a reference.
 *
 * Prose is not a wiring: `@object-ui/types` names the engine in a doc comment
 * explaining which defaults it applies, and that must not read as a production
 * import. Scanning the CODE (rather than the import statements alone) still
 * catches the indirect route — `import * as core` followed by
 * `core.ObjectValidationEngine` — which an import-list regex would miss.
 *
 * String bodies go too, so a URL or an error message quoting the name is prose
 * as well. Template-literal substitutions are kept, since that is real code.
 */
function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (two === '/*') {
      i += 2;
      while (i < src.length && src.slice(i, i + 2) !== '*/') i++;
      i += 2;
      continue;
    }
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        // Keep `${…}` substitutions — they are code, not prose.
        if (quote === '`' && src.slice(i, i + 2) === '${') {
          let depth = 1;
          i += 2;
          const start = i;
          while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            if (depth > 0) i++;
          }
          out += src.slice(start, i);
          i++;
          continue;
        }
        if (src[i] === quote) break;
        i++;
      }
      i++;
      // A module specifier is a string, so preserve the ones that name the
      // engine's module — an `import … from '…/object-validation-engine'` must
      // still be caught.
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Module specifiers are strings, so they are checked separately. */
const IMPORT_SPECIFIER = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;

function referencesEngine(src: string): boolean {
  if (ENGINE_REFERENCE.test(stripCommentsAndStrings(src))) return true;
  for (const [, specifier] of src.matchAll(IMPORT_SPECIFIER)) {
    if (specifier.includes('object-validation-engine')) return true;
  }
  return false;
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Tests are not a production path, and `dist` is build output.
        if (['node_modules', 'dist', '__tests__'].includes(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue;
      if (/\.(test|stories)\.tsx?$/.test(entry.name)) continue;
      out.push(full);
    }
  };

  for (const pkg of readdirSync(PACKAGES_DIR)) {
    const src = join(PACKAGES_DIR, pkg, 'src');
    try {
      if (!statSync(src).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(src);
  }
  return out;
}

describe('the deprecated ObjectValidationEngine stays out of production paths (#3110)', () => {
  it('scans a plausible source tree — so a passing result means something', () => {
    // Without this, a broken path silently scans zero files and the ban above
    // reports success forever. That failure mode is the one objectstack#4115
    // was filed about, so the guard guards itself.
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(500);
    expect(
      files.some((f) => f.endsWith('core/src/validation/validators/object-validation-engine.ts'))
    ).toBe(true);
  });

  it('is referenced only by its own module and the barrels that publish it', () => {
    const offenders = sourceFiles()
      .filter((file) => referencesEngine(readFileSync(file, 'utf8')))
      .map((file) => relative(PACKAGES_DIR, file))
      .filter((rel) => !ALLOWED.includes(rel))
      .sort();

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `A production module now references the deprecated ObjectValidationEngine:\n` +
            offenders.map((o) => `  - packages/${o}`).join('\n') +
            `\n\n` +
            `#3110 decided objectui does NOT run object-level validation rules on the\n` +
            `client: enforcement is single-implementation on the server, and mirroring\n` +
            `it drifts (see ADR-0113's legacy-violation exemption, still divergent).\n\n` +
            `For pre-submit feedback, use a validate-only (dry-run) write instead — it\n` +
            `also covers \`unique\` and \`json_schema\`, which a client cannot check.\n\n` +
            `If you are deliberately reversing the decision (e.g. offline writes),\n` +
            `reverse it in #3110 first, land the spec conformance fixtures it names,\n` +
            `then update ALLOWED here with the reason.`
    ).toEqual([]);
  });
});
