// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12993 — the SMTP port range is declared ONCE, and every door states it from
 * there.
 *
 * ## The criterion this file exists to falsify
 *
 * The bound was written by hand three times: the enforcement in `smtp.ts`, the
 * `(expected 1-65535)` literal on the next line, and `min: 1, max: 65535` on
 * the mail manifest's `smtp_port` field in `@objectstack/service-settings`.
 * The card named two possible repairs and observed that generating the message
 * from the constants is "strictly stronger — it deletes the drift instead of
 * checking for it". So the criterion for sites 1-2 is a **zero**: no second
 * declaration and no second literal anywhere in this package's code.
 *
 * ⭐ The risk with any zero is that it was produced by a scan which would have
 * found nothing whatever the source said. Every zero below therefore sits next
 * to a POSITIVE CONTROL over the same corpus with the same regex — a constant
 * known to be there (`DEFAULT_PORT`, in the very file the bound moved out of),
 * plus a live-regex check and a masking control. A zero next to a hit is a
 * measurement; a zero on its own is only a grep that ran.
 *
 * ## Site 3 is pinned as a MIRROR, and that is a measured choice
 *
 * `@objectstack/service-settings` does not depend on this package, and this
 * package depends on it only as a **devDependency — test-only, no runtime
 * edge**. Making the manifest import the constant would add a runtime edge
 * from a service to a plugin, invert the layering and close a cycle. So the
 * manifest keeps its numbers and this file holds them equal, which is the
 * mechanism `mail-manifest-providers.contract.test.ts` already uses for the
 * provider dropdown over that same devDependency.
 *
 * ## ⛔ The floor is 1 and must never become 0
 *
 * The CLI's listen range floors at 0 ("let the OS choose"). This one floors at
 * 1, because 0 is not a destination. The last two cases exist to make a future
 * "unification" of the two ranges fail loudly rather than silently make `0` a
 * legal SMTP port.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The one code/prose separator in this repo. This file asks "is this a
// DECLARATION or a sentence about one", which is precisely the question that
// module answers. The `.mjs` specifier is deliberate, and
// `scripts/js-comment-mask.d.mts` beside it is the hand-written declaration
// that gives `maskComments` its type — so this package's `tsc --noEmit`
// verdict is a function of that file too, not just of the module.
import { maskComments } from '../../../../../scripts/js-comment-mask.mjs';

import { mailSettingsManifest } from '@objectstack/service-settings';

import {
  SMTP_PORT_MIN,
  SMTP_PORT_MAX,
  SMTP_PORT_RANGE_TEXT,
  isValidSmtpPort,
  formatInvalidSmtpPortNotice,
} from './smtp-port-contract.js';
import { SmtpTransport } from './smtp.js';

/**
 * …/packages/plugins/plugin-email/src/transports
 *
 * ⛔ Seeded from `__dirname`, NOT `fileURLToPath(import.meta.url)` — the same
 * choice `plugin-auth/src/managed-extension-fields.test.ts` documents at
 * length, for the reason that did not move: this package is CJS-typed (no
 * `"type": "module"`, it publishes `dist/index.js` as CommonJS), so under
 * `module: NodeNext` the meta-property is a **TS1470** however well it runs
 * under vitest — and this package's tests ARE in front of `tsc`, because its
 * tsconfig `include` covers the whole `src` tree, test files and all. Measured,
 * not assumed: the first draft of this file failed
 * `pnpm --filter @objectstack/plugin-email typecheck` on exactly that line.
 * `__dirname` type-checks under this package's own config and is defined at
 * runtime by vitest's transform.
 */
const HERE = __dirname;
/** …/packages/plugins/plugin-email/src — this package's whole source tree. */
const SRC = resolve(HERE, '..');

const CONTRACT = 'transports/smtp-port-contract.ts';
const ENFORCEMENT = 'transports/smtp.ts';

/** Every `.ts` file under `src`, as package-relative paths. */
function everySourceFile(dir = SRC, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...everySourceFile(full, `${prefix}${entry}/`));
    } else if (entry.endsWith('.ts')) {
      found.push(`${prefix}${entry}`);
    }
  }
  return found;
}

const FILES = everySourceFile();
/** Path → source with COMMENT spans blanked, so prose cannot answer for code. */
const CODE = new Map(FILES.map((p) => [p, maskComments(readFileSync(join(SRC, p), 'utf8'))]));

const read = (p: string): string => {
  const source = CODE.get(p);
  if (source === undefined) throw new Error(`${p} is not in plugin-email/src — the corpus moved`);
  return source;
};

/** A declaration of `name`, in code — `export` prefix and all. */
const declarationOf = (name: string): RegExp =>
  new RegExp(String.raw`(?:^|[^\w$])(?:const|let|var)\s+${name}\b`);

/** The `smtp_port` specifier as the settings service actually ships it. */
function smtpPortSpecifier(): Record<string, unknown> {
  const spec = (mailSettingsManifest.specifiers as Array<Record<string, unknown>>).find(
    (s) => s.key === 'smtp_port',
  );
  expect(spec, 'mail manifest must declare an `smtp_port` specifier').toBeDefined();
  return spec!;
}

describe('#12993 — one SMTP port range, every door states it from there', () => {
  it('declares the bound in exactly one file, and the scan proves it can see a neighbour', () => {
    const declares = (name: string): string[] =>
      FILES.filter((p) => declarationOf(name).test(read(p)));

    // ── The ZERO: no second declaration of either bound in this package ──
    expect(declares('SMTP_PORT_MIN'), 'SMTP_PORT_MIN is declared outside the contract module')
      .toEqual([CONTRACT]);
    expect(declares('SMTP_PORT_MAX'), 'SMTP_PORT_MAX is declared outside the contract module')
      .toEqual([CONTRACT]);

    // ── The POSITIVE CONTROL: same scan, same corpus, a constant that IS
    // there — and deliberately one that lives in `smtp.ts`, the file the bound
    // moved OUT of, so a scan that had stopped seeing that file cannot pass.
    expect(declares('DEFAULT_PORT'), 'the scan found nothing at all — the zeros above measure nothing')
      .toEqual([ENFORCEMENT]);

    // …and the control is independent of the terms under test in BOTH
    // directions, asserted rather than eyeballed: a control that is a
    // substring of the term under test proves nothing about either.
    for (const term of ['SMTP_PORT_MIN', 'SMTP_PORT_MAX']) {
      expect('DEFAULT_PORT'.includes(term), `the control contains ${term}`).toBe(false);
      expect(term.includes('DEFAULT_PORT'), `${term} contains the control`).toBe(false);
    }

    // The corpus itself has to be real, or `FILES.filter` filters nothing.
    expect(FILES.length, 'no plugin-email sources were scanned').toBeGreaterThan(40);
    expect(FILES, 'the contract module is not in the scanned corpus').toContain(CONTRACT);
    expect(FILES, 'the enforcement is not in the scanned corpus').toContain(ENFORCEMENT);
  });

  it('writes the ceiling nowhere but the contract module — prose does not count as a copy', () => {
    // Tests are excluded on purpose: an expectation that read the bound from
    // the module would assert `x === x` and pin nothing, so `65535` in a
    // `.test.ts` is the point rather than a violation.
    const numeric = /(?<![\w.$])65535(?![\w.$])/;
    const offenders = FILES
      .filter((p) => p !== CONTRACT && !p.endsWith('.test.ts'))
      .filter((p) => numeric.test(read(p)));
    expect(offenders, 'the port ceiling is written as a literal outside the contract module')
      .toEqual([]);

    // Control for the line above — the same regex, over a string that has one.
    expect(numeric.test('const x = 65535;'), 'the numeric scan is a dead regex').toBe(true);

    // ⭐ And the MASKING control. `smtp.ts` still explains the range in prose
    // (that is where the deleted literal used to live), so the raw file
    // contains `65535` while its CODE does not. Without this pair, the zero
    // above would also be produced by a mask that blanked everything.
    const rawEnforcement = readFileSync(join(SRC, ENFORCEMENT), 'utf8');
    expect(rawEnforcement, 'smtp.ts no longer explains the range at all').toContain('65535');
    expect(numeric.test(read(ENFORCEMENT)), 'a prose sentence is being read as a declaration')
      .toBe(false);
  });

  it('GENERATES the refusal from the constants instead of re-spelling it', () => {
    // The card's stronger option, made executable: site 2 does not exist as an
    // independent spelling, so there is nothing left to drift.
    expect(SMTP_PORT_RANGE_TEXT).toBe(`${SMTP_PORT_MIN}-${SMTP_PORT_MAX}`);
    expect(formatInvalidSmtpPortNotice('abc'))
      .toBe(`SmtpTransport: invalid port 'abc' (expected ${SMTP_PORT_MIN}-${SMTP_PORT_MAX})`);

    // The ceiling is typed exactly once even inside its own module — if the
    // notice re-spelled the range, this would be 2.
    const inContract = read(CONTRACT).match(/(?<![\w.$])65535(?![\w.$])/g) ?? [];
    expect(inContract, 'the contract module writes the ceiling more than once').toHaveLength(1);

    // …and it is the transport's REAL refusal, not a parallel sentence.
    expect(() => new SmtpTransport({ host: 'smtp.example.test', port: 99999 }))
      .toThrow(formatInvalidSmtpPortNotice(99999));
  });

  it('holds the settings form equal to the transport across the package boundary', () => {
    // `@objectstack/service-settings` is a devDependency here — test-only, no
    // runtime edge — so the manifest is compared against the real constants
    // rather than against a literal mirrored on this side.
    const spec = smtpPortSpecifier();
    expect(spec.min, 'the mail form floors the port somewhere else than the transport')
      .toBe(SMTP_PORT_MIN);
    expect(spec.max, 'the mail form caps the port somewhere else than the transport')
      .toBe(SMTP_PORT_MAX);

    // Control: the specifier really was read, and is the numeric field whose
    // bounds this service enforces — not an undefined lookup answering `toBe`.
    expect(spec.type).toBe('number');
    expect(spec.default).toBe(587);
    expect(isValidSmtpPort(Number(spec.default)), 'the form default is outside the range')
      .toBe(true);
  });

  it('refactors the enforcement without narrowing what it accepts', () => {
    // The predicate `smtp.ts` had before this card, kept verbatim as the
    // oracle. Reading the bound from the module here would assert `x === x`;
    // the point is that the OLD expression and the NEW function agree.
    const legacyAccepts = (port: number): boolean =>
      !(!Number.isFinite(port) || port < 1 || port > 65535);

    const table = [
      1, 25, 465, 587, 2525, 65535, // inside
      0, -1, 65536, 99999, // outside
      Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, // not finite
      587.5, 0.5, 65535.5, // non-integers: accepted iff they were accepted before
    ];
    for (const port of table) {
      expect(isValidSmtpPort(port), `accept set changed for ${String(port)}`)
        .toBe(legacyAccepts(port));
    }

    // The table is not vacuous in either direction.
    expect(table.filter(legacyAccepts).length).toBeGreaterThan(0);
    expect(table.filter((p) => !legacyAccepts(p)).length).toBeGreaterThan(0);
  });

  it('⛔ floors at 1, not at 0 — this range is not the CLI listen range', () => {
    // The single most important fence on this card. Port 0 is meaningful only
    // to a listener ("let the OS choose"); it is not a destination. A repair
    // that collapsed the two contracts onto one constant would make this pass
    // only by making `0` a legal SMTP port.
    expect(SMTP_PORT_MIN).toBe(1);
    expect(isValidSmtpPort(0), '0 became a legal SMTP port').toBe(false);
    expect(() => new SmtpTransport({ host: 'smtp.example.test', port: 0 })).toThrow(/invalid port/);
    expect(smtpPortSpecifier().min, 'the settings form would let 0 be saved').toBe(1);
  });

  it('never reaches for the CLI’s port contract to supply this bound', () => {
    // Prose about the CLI module is expected and welcome (this package's
    // contract module explains the distinction at length) — an IMPORT is not.
    const importers = FILES
      .filter((p) => !p.endsWith('.test.ts'))
      .filter((p) => /@objectstack\/cli|utils\/port-contract\.js/.test(read(p)));
    expect(importers, 'plugin-email imports a port bound from the CLI').toEqual([]);

    // Control: the same corpus DOES contain the prose, so the scan is live and
    // the masking is what produced the zero.
    // ⛔ The bare filename, deliberately — NOT the repo-relative path. The
    // cross-package-test-inputs collector takes quoted paths without parsing,
    // so spelling the CLI's path here would force this package to declare an
    // input radius over `packages/cli/src/**` for a string it only reads out
    // of its own file. A literal with no separator is refused as too generic,
    // which is the whole point: the control stays live, the radius stays honest.
    expect(readFileSync(join(SRC, CONTRACT), 'utf8')).toContain('port-contract.ts');
  });
});
