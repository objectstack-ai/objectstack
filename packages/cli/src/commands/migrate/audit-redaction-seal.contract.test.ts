// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0154 D7] The four `os migrate audit-*` ledger-copy rewrites compose the
// crypto `os serve` seals with (`composeRedactionSeal`) and hand its `seal` to
// every run, hot and archive, so a sealed row is amended before it is rewritten
// or refused; and a run that refused one exits non-zero. What the `seal` does is
// pinned on a live engine in plugin-audit
// (`audit-seal-redaction-live.integration.test.ts`); the failure mode left here
// is an EDIT that drops the option from one call, which reads as a run that
// rewrites a sealed row unamended. A source scan, comments masked, as
// `../serve-audit-registration.contract.test.ts` reads `serve.ts`.
//
// [ADR-0154 D3 amended, seat ruling 6885005594] And every rewrite run sits
// inside the one `underAuditSealLock` call, which holds the audit seal lock for
// an `--apply` run's whole length, on the objects the command rewrites, with the
// operator's `--sealer-stopped`. What the hold does is pinned in plugin-audit
// (`audit-seal/audit-seal-lock.test.ts`); here, an EDIT that moves a run out of
// the hold, or drops the flag, reads as a run a sealer pass can seal under.

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
  'audit-side-copies.ts': ['migrateSideCopies', 'migrateArchivedSideCopies'],
  'audit-metadata-bodies.ts': ['migrateStoredMetadataBodyCopies'],
};

/**
 * Each command's list of the objects it rewrites, as plugin-audit exports it —
 * or, for `audit-side-copies`, the run's selection of `SIDE_COPY_TABLES`
 * (`--object` narrows it), the same list its hot and archive runs are handed.
 */
const REWRITTEN: Record<string, string> = {
  'audit-mail-bodies.ts': 'MAIL_LOG_BODY_COPY_OBJECTS',
  'audit-key-material.ts': 'KEY_MATERIAL_COPY_TABLES',
  'audit-side-copies.ts': 'objects',
  'audit-metadata-bodies.ts': 'STORED_METADATA_BODY_REWRITTEN_OBJECTS',
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

    it(`${file}: awaits the seal before the lock hold, so a host signer that cannot be resolved fails the run first (#34519)`, () => {
      expect(source.match(/const seal = await redaction\.seal\(stack\.kernel, engine\);/g)).toHaveLength(1);
      expect(source.indexOf('await redaction.seal(')).toBeLessThan(source.indexOf('underAuditSealLock('));
    });

    it(`${file}: exits non-zero when a sealed row was refused, or the seal lock was lost, as for a failure`, () => {
      expect(source.match(/failures > 0 \|\| (report\.)?refused > 0 \|\| lostLock\) this\.exit\(1\)/g)).toHaveLength(2);
    });

    it(`${file}: declares --sealer-stopped, the one shared flag (D3 amended, B)`, () => {
      expect(source).toMatch(/'sealer-stopped': sealerStoppedFlag,/);
    });

    it(`${file}: runs every rewrite inside one hold of the audit seal lock, on its objects, with the flag (D3 amended, E)`, () => {
      const holds = calls(source, 'underAuditSealLock');
      expect(holds).toHaveLength(1);
      const [hold] = holds;
      // The warn channel is called through its receiver (`check:logger-receiver-detach`), never handed on bare.
      expect(hold).toMatch(/\{ apply, sealerStopped: flags\['sealer-stopped'\], objects: (\w+), warn: \(line\) => logger\.warn\(line\) \}/);
      expect(/objects: (\w+)/.exec(hold)?.[1]).toBe(REWRITTEN[file]);
      for (const run of runs) expect(calls(hold, run), run).toHaveLength(1);
    });
  }
});
