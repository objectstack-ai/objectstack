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
 * ## #13189 — the accept set narrowed, and this file is where that is visible
 *
 * `isValidSmtpPort` now tests INTEGRALITY. That is a deliberate narrowing of
 * the set #12993 pinned, and the pin below was written to make exactly this
 * kind of change loud rather than to forbid it — so it was UPDATED, never
 * deleted: the legacy oracle stays, an exhaustive integer sweep says the
 * integer accept set did not move at all, and the one axis that did move is
 * named value by value. The sentence moved with the guard (`expected an
 * integer 1-65535`), because `587.5` is inside `1-65535` and a door that
 * refuses it while saying only that is stating a rule it does not enforce.
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
      .toBe(`SmtpTransport: invalid port 'abc' (expected an integer ${SMTP_PORT_MIN}-${SMTP_PORT_MAX})`);

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

  it('narrows the accept set in exactly ONE dimension — integrality — and nowhere else (#13189)', () => {
    // ⚠️ This case was `refactors the enforcement without narrowing what it
    // accepts` when #12993 moved the predicate here, and `587.5` sat in its
    // table as MEASURED, not endorsed. #13189 is the card that SPENDS that
    // pin: the accept set really does narrow now, and the pin's job was always
    // to make such a change visible rather than to prevent one. So the oracle
    // and the values stay exactly where they were; what changed is that the
    // two are now expected to disagree on ONE axis, asserted term by term so
    // that a second narrowing — or any widening — still fails right here.
    const legacyAccepts = (port: number): boolean =>
      !(!Number.isFinite(port) || port < 1 || port > 65535);

    const integers = [
      1, 25, 465, 587, 2525, 65535, // inside
      0, -1, 65536, 99999, // outside
    ];
    const nonIntegers = [
      587.5, 1.5, 2525.25, 65534.5, // INSIDE the range — accepted until this card
      0.5, 65535.5, -0.5, 65536.5, // outside it — the old bounds refused these too
      Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, // not finite
    ];

    // ── UNCHANGED: on every integer the predicate is still, bound for bound,
    // the expression `smtp.ts` carried before #12993.
    for (const port of integers) {
      expect(isValidSmtpPort(port), `accept set changed for ${String(port)}`)
        .toBe(legacyAccepts(port));
    }

    // ⭐ …and the strongest available form of "and nowhere else": EVERY
    // integer from below the floor to above the ceiling, not ten sampled
    // ones. 65k comparisons of two cheap predicates costs milliseconds and
    // closes the gap a table cannot.
    let divergences = 0;
    for (let port = -2; port <= SMTP_PORT_MAX + 2; port += 1) {
      if (isValidSmtpPort(port) !== legacyAccepts(port)) divergences += 1;
    }
    expect(divergences, 'the integer accept set moved somewhere the table does not sample')
      .toBe(0);

    // Control for that zero — the same sweep against a floor deliberately one
    // too high, which MUST find the one integer it disagrees about. Without
    // this the loop above could be counting nothing at all.
    let seen = 0;
    for (let port = -2; port <= SMTP_PORT_MAX + 2; port += 1) {
      if ((port >= 2 && port <= SMTP_PORT_MAX) !== legacyAccepts(port)) seen += 1;
    }
    expect(seen, 'the integer sweep is a dead loop').toBe(1);

    // ── THE ONE CHANGE: nothing non-integral is accepted any more.
    for (const port of nonIntegers) {
      expect(isValidSmtpPort(port), `${String(port)} is still accepted`).toBe(false);
    }

    // …and exactly WHICH values this card moved, spelled out rather than
    // summarised: accepted yesterday, refused today, and not one of them could
    // ever have completed a connection.
    //
    // ⚠️ MEASURED, and it corrected a first draft of this very list: a
    // fraction only moved if it was INSIDE the range, so `0.5` and `65535.5`
    // belong in the half below, not here. `0.5 < SMTP_PORT_MIN` and
    // `65535.5 > SMTP_PORT_MAX`, so the old bounds already refused both — and
    // listing them as "narrowed by this card" would have overstated the
    // change while still passing a weaker assertion.
    const moved = [587.5, 1.5, 2525.25, 65534.5];
    expect(moved.filter(legacyAccepts), 'these were not accepted before, so nothing moved')
      .toEqual(moved);
    expect(moved.filter((port) => isValidSmtpPort(port)), 'a fractional port is accepted again')
      .toEqual([]);

    // The other half, asserted rather than left implied: every remaining
    // non-integer was ALREADY refused, so this card narrowed the in-range
    // fractions and nothing else.
    const unmoved = nonIntegers.filter((port) => !moved.includes(port));
    expect(unmoved.filter(legacyAccepts), 'this card narrowed more than the in-range fractions')
      .toEqual([]);
    expect(unmoved.length, 'the unmoved half is empty — it asserts nothing').toBeGreaterThan(0);

    // The tables are not vacuous in either direction.
    expect(integers.filter(legacyAccepts).length).toBeGreaterThan(0);
    expect(integers.filter((p) => !legacyAccepts(p)).length).toBeGreaterThan(0);
    expect(nonIntegers.filter(legacyAccepts).length).toBeGreaterThan(0);
  });

  it('⭐ states the rule it enforces — the sentence and the guard cannot disagree (#13189)', () => {
    // The defect this card repairs, in one line: `587.5` **is** inside
    // `1-65535`, so a refusal reading `(expected 1-65535)` described a door
    // that had just let it through. The sentence is the operator's only view
    // of the rule, so a guard that tests integrality without saying so would
    // have moved the lie rather than removed it.
    const notice = formatInvalidSmtpPortNotice(587.5);
    expect(notice, 'the refusal states a range the guard no longer enforces alone')
      .toContain('integer');

    // ⭐ The mechanical form, and the reason this is not a `toContain` on a
    // word: read the range back OUT of the rendered sentence and confirm that
    // a value satisfying it is refused anyway — which is precisely why the
    // range can no longer be the whole sentence.
    const rendered = notice.match(/\((?:[^()]*?)(\d+)-(\d+)\)/);
    expect(rendered, 'the refusal no longer renders the range at all').not.toBeNull();
    const low = Number(rendered![1]);
    const high = Number(rendered![2]);
    expect(low, 'the rendered floor drifted from the constant').toBe(SMTP_PORT_MIN);
    expect(high, 'the rendered ceiling drifted from the constant').toBe(SMTP_PORT_MAX);
    expect(587.5 >= low && 587.5 <= high, 'the example stopped being inside the stated range')
      .toBe(true);
    expect(isValidSmtpPort(587.5), '587.5 is accepted again').toBe(false);

    // ⛔ The range is still GENERATED, never re-typed — the word added above
    // is prose about the predicate and must not have dragged a literal in
    // with it. (`SMTP_PORT_RANGE_TEXT` is asserted against the constants two
    // cases up; this holds the notice to that same construct.)
    expect(notice).toContain(SMTP_PORT_RANGE_TEXT);
  });

  it('refuses a fractional port AT CONSTRUCTION, under its own name (#13189)', () => {
    // BEFORE, MEASURED on `origin/main@56c5b1dbe` through the built
    // `dist/index.js`: construction ACCEPTED `587.5`, `describe().port` read
    // it straight back, and the operator's first sight of the problem came at
    // SEND time as a bare `RangeError` — `code: 'ECONNECTION'` once nodemailer
    // has re-coded `ERR_SOCKET_BAD_PORT` — reading `Port should be >= 0 and <
    // 65536. Received type number (587.5).`, which names a TCP rule and no
    // part of the Settings field the operator typed in.
    expect(() => new SmtpTransport({ host: 'smtp.example.test', port: 587.5 }))
      .toThrow(formatInvalidSmtpPortNotice(587.5));

    // The refusal carries the operator's OWN value. Asserted through the
    // contract's generator above and then, separately, on the spelling — a
    // bare `.toThrow()` here would also pass on the `host is required`
    // refusal that guards the line before it.
    expect(() => new SmtpTransport({ host: 'smtp.example.test', port: 587.5 }))
      .toThrow(/invalid port '587\.5'/);

    // ⛔ The fence on the repair: integer ports still construct, at both
    // bounds. A guard that refused `587.5` by refusing everything would
    // satisfy every line above this one.
    for (const port of [SMTP_PORT_MIN, 25, 465, 587, SMTP_PORT_MAX]) {
      expect(new SmtpTransport({ host: 'smtp.example.test', port }).describe().port)
        .toBe(port);
    }
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
