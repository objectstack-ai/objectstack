// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Every SMTP transport this package builds carries the host's connect policy
// when one is set. That holds only while every construction goes through the
// two places that apply it: `makeTransport` (handed the policy by the plugin)
// and the plugin's own `buildSmtpTransport` / `buildTransport` helpers. This
// census reads the package's source and fails when a construction appears
// anywhere else, so a new site has to be routed through them to land.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { maskCommentsAndLiterals } from '../../../../scripts/js-comment-mask.mjs';

// Seeded from `__dirname`, as this package's `smtp-port-contract.test.ts` is:
// the package's build config compiles to CommonJS, where `import.meta` does
// not type-check.
const SRC = path.resolve(__dirname);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.ts$/.test(name) && !/\.(test|testkit)\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

/** The `[start, end)` span of the body of the function or method `decl` opens, in `code`. */
function bodyOf(code: string, decl: RegExp): [number, number] | undefined {
  const m = decl.exec(code);
  if (!m) return undefined;
  const open = code.indexOf('{', m.index + m[0].length);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return [open, i + 1];
  }
  return undefined;
}

/** The functions allowed to construct, per file, by declaration. */
const SEAMS: Record<string, Record<string, RegExp>> = {
  'email-plugin.ts': {
    buildSmtpTransport: /\bprivate\s+buildSmtpTransport\s*\(/,
    buildTransport: /\bprivate\s+buildTransport\s*\(/,
  },
  'transports/index.ts': {
    makeTransport: /\bexport\s+function\s+makeTransport\s*\(/,
  },
};

/** Each match of `pattern` in the package's source, as `file → seam` (or `file → OUTSIDE`). */
function sites(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const code = maskCommentsAndLiterals(readFileSync(file, 'utf8'));
    const spans = Object.entries(SEAMS[rel] ?? {}).map(([name, decl]) => {
      const span = bodyOf(code, decl);
      if (!span) throw new Error(`census: ${rel} no longer declares ${name}`);
      return [name, span] as const;
    });
    for (const m of code.matchAll(pattern)) {
      const at = m.index ?? 0;
      const seam = spans.find(([, [a, b]]) => at >= a && at < b)?.[0] ?? 'OUTSIDE';
      found.push(`${rel} → ${seam}`);
    }
  }
  return found.sort();
}

describe('every SMTP transport construction in the package goes through the connect-policy seam', () => {
  it('constructs SmtpTransport only in makeTransport and the plugin\'s buildSmtpTransport', () => {
    expect(sites(/\bnew\s+SmtpTransport\s*\(/g)).toEqual([
      'email-plugin.ts → buildSmtpTransport',
      'transports/index.ts → makeTransport',
    ]);
  });

  it('calls makeTransport only from the plugin\'s buildTransport', () => {
    expect(sites(/(?<![\w.]|function\s+)makeTransport\s*\(/g)).toEqual([
      'email-plugin.ts → buildTransport',
    ]);
  });

  it('the census sees the constructions it counts (positive control)', () => {
    // A construction outside a seam is reported as such, not skipped.
    const code = 'class P {\n  private buildSmtpTransport() { return 1; }\n  other() { return new SmtpTransport({}); }\n}';
    const span = bodyOf(code, SEAMS['email-plugin.ts'].buildSmtpTransport)!;
    const at = code.indexOf('new SmtpTransport');
    expect(at >= span[0] && at < span[1]).toBe(false);
    expect(sourceFiles(SRC).map((f) => path.relative(SRC, f).split(path.sep).join('/'))).toEqual(
      expect.arrayContaining(['email-plugin.ts', 'transports/index.ts', 'transports/smtp.ts']),
    );
  });
});
