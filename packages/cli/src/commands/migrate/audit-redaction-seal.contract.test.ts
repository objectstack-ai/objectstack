// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0154 D7] The three `os migrate audit-*` ledger-copy rewrites compose the
// crypto `os serve` seals with (`composeRedactionSeal`) and hand its `seal` to
// every run, hot and archive, so a sealed row is amended before it is rewritten
// or refused; and a run that refused one exits non-zero. What the `seal` does is
// pinned on a live engine in plugin-audit
// (`audit-seal-redaction-live.integration.test.ts`); the failure mode left here
// is an EDIT that drops the option from one call, which reads as a run that
// rewrites a sealed row unamended. A source scan, comments masked, as
// `../serve-audit-registration.contract.test.ts` reads `serve.ts`.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskComments } from '../../../../../scripts/js-comment-mask.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Each command and the rewrite runs it makes. */
const COMMANDS: Record<string, readonly string[]> = {
  'audit-mail-bodies.ts': ['migrateMailLogBodyCopies', 'migrateArchivedMailLogBodyCopies'],
  'audit-key-material.ts': ['migrateKeyMaterialCopies', 'migrateArchivedKeyMaterialCopies'],
  'audit-metadata-bodies.ts': ['migrateStoredMetadataBodyCopies'],
};

/** The argument text of every `name(` call in `source`, parentheses walked. */
function calls(source: string, name: string): string[] {
  const found: string[] = [];
  const at = new RegExp(`\\b${name}\\(`, 'g');
  for (let m = at.exec(source); m; m = at.exec(source)) {
    let depth = 1;
    let j = m.index + m[0].length;
    for (; j < source.length && depth > 0; j++) {
      if (source[j] === '(') depth++;
      else if (source[j] === ')') depth--;
    }
    found.push(source.slice(m.index + m[0].length, j - 1));
  }
  return found;
}

describe('os migrate audit-* amend a sealed row first (ADR-0154 D7)', () => {
  for (const [file, runs] of Object.entries(COMMANDS)) {
    const source = maskComments(readFileSync(path.join(HERE, file), 'utf8'));

    it(`${file}: composes the crypto os serve seals with into its boot`, () => {
      expect(calls(source, 'composeRedactionSeal')).toEqual(['']);
      expect(source).toContain('...redaction.plugins');
    });

    it(`${file}: hands the seal to every rewrite run`, () => {
      for (const run of runs) {
        const args = calls(source, run);
        expect(args, run).toHaveLength(1);
        expect(args[0], run).toMatch(/\bseal\b/);
      }
    });

    it(`${file}: exits non-zero when a sealed row was refused, as for a failure`, () => {
      expect(source.match(/failures > 0 \|\| (report\.)?refused > 0\) this\.exit\(1\)/g)).toHaveLength(2);
    });
  }
});
