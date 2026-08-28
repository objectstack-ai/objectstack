// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12673 — the port range is declared ONCE, and all three doors refuse from it.
 *
 * ## The criterion this file exists to falsify
 *
 * `os dev`, `os start` and `os serve` all take a port and the first two spawn
 * the third. The maintainer's ruling (2026-08-28, option 甲) is that they share
 * ONE contract — not that each grows its own bound. #12620 and #12662 had both
 * declined to copy the range to a second entry point, and the ruling is the
 * front of that judgement rather than its reverse: *"still exactly one copy of
 * the range, which is what #12620/#12662 protected"*. So the criterion is a
 * ZERO — no second declaration anywhere — and the risk with any zero is that it
 * is produced by a scan which would find nothing whatever the source said.
 *
 * ⭐ Hence the POSITIVE CONTROL below. The same scan, over the same corpus, must
 * find `PORT_SEARCH_SPAN` — a constant known to exist, in a file the port range
 * used to share. A zero next to a hit is a measurement; a zero on its own is
 * only a grep that ran.
 *
 * ⛔ And the control must not be a SUBSTRING of the term under test, which is a
 * live hazard on this card rather than a general caution: it touches
 * `PORT` and `OS_PORT`, and `OS_PORT="abc"` CONTAINS `PORT="abc"` — a
 * containment check for the second is satisfied by the first, and that exact
 * overlap has produced a false positive in this lane already. Both directions
 * of non-containment are asserted mechanically below rather than eyeballed, and
 * the spelling assertions read the named source by EXTRACTION, never by
 * `includes`.
 *
 * ## What the other cases pin
 *
 * The single source is only half the ruling. The other half is that each door
 * refuses **at its own door, in the operator's own spelling, before spawning** —
 * so this file also pins that all three commands import the contract, that
 * neither parent declares a bound of its own, that each parent's refusal sits
 * ahead of its spawn, and that the accept set is exactly
 * {@link parseRequestedPort}'s for the table measured end to end through the
 * three real commands.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The one code/prose separator (`scripts/js-comment-mask.mjs`), typed by the
// hand-written `.d.mts` beside it. A private `stripComments` here would be one
// of the two drifting families that module's header documents — and this file
// asks "is this a DECLARATION or a sentence about one", which is exactly the
// question it answers.
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

import {
  MIN_PORT,
  MAX_PORT,
  parseRequestedPort,
  describePortSource,
  formatInvalidPortNotice,
} from './port-contract.js';

/** …/packages/cli/src/utils */
const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** …/packages/cli/src — the whole CLI source tree, this package's own. */
const SRC = resolve(HERE, '..');

const CONTRACT = 'utils/port-contract.ts';
const DOORS = ['commands/serve.ts', 'commands/dev.ts', 'commands/start.ts'] as const;

/** Every `.ts` file under `packages/cli/src`, as package-relative paths. */
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
  if (source === undefined) throw new Error(`${p} is not in packages/cli/src — the corpus moved`);
  return source;
};

/**
 * Strip SGR escapes. `chalk` is inert under a non-TTY runner but not guaranteed
 * to be, and every assertion here is about TEXT.
 *
 * ⛔ The ESC byte is built with `String.fromCharCode` rather than written — the
 * spelling its neighbour `serve-port-validation.test.ts` already uses, for a
 * reason this file re-measured the hard way: written as an escape inside a
 * regex literal it is materialised into a REAL control byte by the editing
 * tool, and `check:nul-bytes` catches it (it did, on the first draft of this
 * file, at this exact line).
 */
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const plain = (text: string): string => text.replace(SGR, '');

/**
 * The name a refusal states, read by EXTRACTION.
 *
 * ⛔ Never `notice.includes('PORT=…')` — see this file's header: `OS_PORT="x"`
 * contains `PORT="x"`, so containment cannot tell the two channels apart. This
 * reads the token between the colon and its separator and returns it whole, so
 * `OS_PORT` and `PORT` are different answers rather than overlapping ones.
 */
function nameStatedBy(notice: string): string {
  const match = plain(notice).match(/✗ Invalid port: (--port|[A-Za-z_][A-Za-z0-9_]*)(?:[ =]|$)/m);
  if (!match) throw new Error(`no source name in refusal: ${JSON.stringify(plain(notice).slice(0, 80))}`);
  return match[1];
}

/** A declaration of `name`, in code — `export` prefix and all. */
const declarationOf = (name: string): RegExp =>
  new RegExp(String.raw`(?:^|[^\w$])(?:const|let|var)\s+${name}\b`);

describe('#12673 — one port range, three doors', () => {
  it('declares the range in exactly one file, and the scan proves it can see a neighbour', () => {
    const declares = (name: string): string[] =>
      FILES.filter((p) => declarationOf(name).test(read(p)));

    // ── The ZERO: no second declaration of either bound, anywhere in the CLI ──
    expect(declares('MIN_PORT'), 'MIN_PORT is declared outside the contract module').toEqual([CONTRACT]);
    expect(declares('MAX_PORT'), 'MAX_PORT is declared outside the contract module').toEqual([CONTRACT]);

    // ── The POSITIVE CONTROL: the same scan, same corpus, a constant that IS
    // there. Without this, both assertions above pass on a scan that reads
    // nothing — the corpus could be empty and the regex could be wrong.
    const control = declares('PORT_SEARCH_SPAN');
    expect(control, 'the scan found nothing at all — the zeros above measure nothing')
      .toEqual(['commands/serve.ts']);

    // …and the control is independent of the terms under test in BOTH
    // directions. Asserted, not eyeballed: this card's own `PORT` / `OS_PORT`
    // pair is a live example of a containment that reads as a match.
    for (const term of ['MIN_PORT', 'MAX_PORT']) {
      expect('PORT_SEARCH_SPAN'.includes(term), `the control contains ${term}`).toBe(false);
      expect(term.includes('PORT_SEARCH_SPAN'), `${term} contains the control`).toBe(false);
    }

    // The corpus itself has to be real, or `FILES.filter` filters nothing.
    expect(FILES.length, 'no CLI sources were scanned').toBeGreaterThan(100);
    expect(FILES, 'the contract module is not in the scanned corpus').toContain(CONTRACT);
  });

  it('writes the two numbers nowhere but the contract module', () => {
    // Both bounds are MEASURED facts about `listen()` (see the module), and a
    // second hand-written copy is the drift this card exists to prevent. Tests
    // are excluded on purpose: an expectation that read the bound from the
    // module would assert `x === x` and pin nothing, so `65535` appearing in a
    // `.test.ts` is the point rather than a violation.
    const numeric = /(?<![\w.$])(?:65535|65536)(?![\w.$])/;
    const offenders = FILES
      .filter((p) => p !== CONTRACT && !p.endsWith('.test.ts'))
      .filter((p) => numeric.test(read(p)));
    expect(offenders, 'a port bound is written as a literal outside the contract module').toEqual([]);

    // Control for the line above — the same regex, over a string that has one.
    expect(numeric.test('const x = 65535;'), 'the numeric scan is a dead regex').toBe(true);
    // …and it is the CODE that is scanned: `serve.ts` still explains the range
    // in prose, and that sentence must not be read as a declaration.
    expect(readFileSync(join(SRC, 'commands/serve.ts'), 'utf8')).toContain('65535');
  });

  it('gives every door the same import and no bound of its own', () => {
    for (const door of DOORS) {
      const source = read(door);
      expect(source, `${door} does not import the port contract`)
        .toContain("from '../utils/port-contract.js'");
      expect(source, `${door} does not call the shared reader`).toContain('parseRequestedPort(');
      expect(source, `${door} does not call the shared refusal`).toContain('formatInvalidPortNotice(');
      expect(source, `${door} does not name the source it refuses in`).toContain('describePortSource(');
      expect(declarationOf('MIN_PORT').test(source), `${door} declares its own floor`).toBe(false);
      expect(declarationOf('MAX_PORT').test(source), `${door} declares its own ceiling`).toBe(false);
    }
  });

  it('puts each parent’s refusal AHEAD of its spawn', () => {
    // The ruling's words: each door validates "BEFORE spawning". A door that
    // drifted below the spawn would still refuse — one process too late, which
    // is the whole defect it replaces.
    const dev = read('commands/dev.ts');
    const devDoor = dev.indexOf('if (parseRequestedPort(port) === null) {');
    const devSpawn = dev.indexOf('const spawnServeChild = ');
    expect(devDoor, 'dev has no port door').toBeGreaterThan(-1);
    expect(devSpawn, 'dev’s serve spawn is gone').toBeGreaterThan(-1);
    expect(devDoor).toBeLessThan(devSpawn);

    const start = read('commands/start.ts');
    const startDoor = start.indexOf('if (parseRequestedPort(portText) === null) {');
    const startSpawn = start.indexOf('const child = spawn(');
    expect(startDoor, 'start has no port door').toBeGreaterThan(-1);
    expect(startSpawn, 'start’s serve spawn is gone').toBeGreaterThan(-1);
    expect(startDoor).toBeLessThan(startSpawn);
  });

  it('keeps dev’s empty `--port` DROPPED rather than refused', () => {
    // MEASURED on `origin/main` through the real command: `os dev --port ""`
    // boots. The empty string is falsy, so the forwarding guard drops it and
    // the child resolves its own default — a door that refused every text
    // `parseRequestedPort` rejects would refuse a value that starts a server,
    // narrowing a published command's accept set. The door therefore shares the
    // forwarding guard rather than restating it, and both read one variable.
    const dev = read('commands/dev.ts');
    expect(dev, 'dev’s door no longer shares the forwarding guard').toMatch(
      /if \(port\) \{[\s\S]{0,600}?parseRequestedPort\(port\)/,
    );
    expect(dev, 'dev’s forwarding guard changed shape').toContain("...(port ? ['--port', port] : [])");
  });

  it('states the operator’s own spelling — read by extraction, never containment', () => {
    const fromFlag = formatInvalidPortNotice('abc', describePortSource(false, {}));
    const fromOsPort = formatInvalidPortNotice('abc', describePortSource(true, { OS_PORT: 'abc' }));
    const fromPort = formatInvalidPortNotice('abc', describePortSource(true, { PORT: 'abc' }));

    expect(nameStatedBy(fromFlag)).toBe('--port');
    expect(nameStatedBy(fromOsPort)).toBe('OS_PORT');
    expect(nameStatedBy(fromPort)).toBe('PORT');

    // ⭐ The trap, demonstrated rather than described. The naive containment
    // check for the `PORT` channel is TRUE of the `OS_PORT` refusal, because
    // one spelling contains the other; the extraction above separates them.
    expect(plain(fromOsPort).includes('PORT="abc"'), 'the naive containment check').toBe(true);
    expect(nameStatedBy(fromOsPort), 'the exact reading').not.toBe('PORT');

    // Every refusal states the bounds it enforces, read from the module.
    for (const notice of [fromFlag, fromOsPort, fromPort]) {
      expect(plain(notice)).toContain(`from ${MIN_PORT} to ${MAX_PORT}`);
    }
  });

  it('keeps the accept set exactly parseRequestedPort’s', () => {
    // MEASURED end to end, before and after this change, by driving each value
    // through the three REAL commands on all three channels (54 rows per
    // command). `accepted` here is the end-to-end verdict those runs recorded;
    // the door's own decision is `parseRequestedPort`, and the two agree row
    // for row. ⭐ The coerced rows are the point: a strict-decimal reader would
    // refuse six values that boot a server today.
    const TABLE: Array<{ raw: string; accepted: boolean; note: string }> = [
      { raw: '3000', accepted: true, note: 'plain decimal' },
      { raw: '65535', accepted: true, note: 'the ceiling itself' },
      { raw: '0', accepted: true, note: '0 is a REQUEST for a kernel-assigned port' },
      { raw: ' 3000', accepted: true, note: 'leading space — production env vars carry it' },
      { raw: '3000 ', accepted: true, note: 'trailing space' },
      { raw: '+3000', accepted: true, note: 'explicit sign' },
      { raw: '08080', accepted: true, note: 'leading zero, decimal since ES5' },
      { raw: '3e3', accepted: true, note: 'coerced — selects port 3, not 3000' },
      { raw: '0x0BB8', accepted: true, note: 'coerced — hex, selects 3000' },
      { raw: '3000.0', accepted: true, note: 'coerced — selects 3000' },
      { raw: '3000abc', accepted: true, note: 'coerced — trailing text discarded' },
      { raw: '0b111', accepted: true, note: 'coerced — selects 0' },
      { raw: '65536', accepted: false, note: 'one past the ceiling' },
      { raw: '99999', accepted: false, note: 'the issue’s own example' },
      { raw: '-1', accepted: false, note: 'below the floor' },
      { raw: 'abc', accepted: false, note: 'not a number at all' },
      { raw: '', accepted: false, note: 'defined but empty — never falls back to 3000' },
      { raw: '   ', accepted: false, note: 'whitespace only' },
    ];

    for (const { raw, accepted, note } of TABLE) {
      expect(parseRequestedPort(raw) !== null, `${JSON.stringify(raw)} (${note})`).toBe(accepted);
    }

    // Anti-vacuity: the table has to hold both verdicts, or the loop asserts
    // one arm and reads as a pass over a reader that answers a constant.
    expect(TABLE.some((r) => r.accepted)).toBe(true);
    expect(TABLE.some((r) => !r.accepted)).toBe(true);
  });
});
