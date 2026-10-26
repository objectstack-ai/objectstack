/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectui check` names what it refused, and never calls a file it did not
 * validate passed (objectui#11007).
 *
 * Measured before this change, on the card's own two documents:
 *
 * - A root `object-map` whose `map` block carries the typo `latitudeFieId`
 *   was listed under "did not validate" as `map.json (type "object-map")`.
 *   The validator's issue — `Unrecognized key: "latitudeFieId"` at `map` —
 *   was already in hand and was thrown away, so the list named the file and
 *   not the key.
 * - The same node one level down, under a page's `children`, was admitted on
 *   the `children` key alone and never parsed. The run ended
 *   「✓ All checks passed」 over it.
 *
 * The triage ruling on the card chose both halves, narrowly: print the first
 * issue for what `check` already parses, and make the closing line say what
 * was actually established. ⛔ It ruled out giving `check` a nested walk of its
 * own — the verdict is `objectui validate`'s — and the third block below pins
 * that boundary, so a walk added later turns red here and sends its author to
 * the ruling.
 *
 * Expected text is derived from the command's own `describeFirstIssue` and
 * `closingLine`, fed from the real issues of the door `check` parses with
 * (`validateAuthoredDocument`, the strict authoring face since objectui#5250), rather than
 * copied here as literals. What the assertions hold by hand is the SUBJECT:
 * the refused key, the path it sits at, and the counts.
 *
 * Fixtures live under `os.tmpdir()`, never in the repo tree: `check()` globs
 * every JSON file under the directory it is handed, so a fixture committed
 * inside this workspace would be scanned by every other run of the command,
 * the repo's own `pnpm check` included.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateAuthoredDocument } from '../utils/authoring-face.js';

import { check, closingLine, describeFirstIssue } from '../commands/check.js';
import { formatIssuePath } from '../utils/issue-path.js';

/** The card's own typo: `latitudeFieId`, capital i where the l belongs. */
const TYPO_KEY = 'latitudeFieId';

/**
 * The card's root case: no structural key, so the validity arm parses it.
 * Written in the spec's `properties` bag, which an authored `object-map` takes
 * its props in since objectui#10859 batch 5: the flat spelling is refused by
 * name, so the typo sits at `properties.map`.
 */
const ROOT_TYPO = {
  type: 'object-map',
  properties: { objectName: 'stores', map: { [TYPO_KEY]: 'lat', longitudeField: 'lng' } },
};

const ROOT_CLEAN = {
  type: 'object-map',
  properties: { objectName: 'stores', map: { latitudeField: 'lat', longitudeField: 'lng' } },
};

/** Where the `map` block sits on an authored `object-map` (objectui#10859 batch 5). */
const MAP_PATH = ['properties', 'map'];

/** The card's nested case: the same node under a page's `children`. */
const NESTED_TYPO = { type: 'div', children: [ROOT_TYPO] };
const NESTED_CLEAN = { type: 'div', children: [ROOT_CLEAN] };

let cwd: string;
let lines: string[];
let exitCodes: number[];
let restoreLog: () => void;

function writeSchema(name: string, body: unknown): void {
  writeFileSync(join(cwd, name), JSON.stringify(body));
}

/**
 * The CSI sequences chalk may add. The escape byte is built with
 * `String.fromCharCode` rather than spelled into the source, so this file holds
 * no raw control character and no escape a tooling pass could materialise into
 * one (objectui AGENTS.md byte discipline).
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function plainLines(): string[] {
  return lines.map((l) => l.replace(ANSI, ''));
}

/**
 * The validator's issues for a document the test asserts does not validate —
 * read through the same door `check` and `validate` parse with (objectui#5250).
 */
function issuesOf(document: unknown) {
  const result = validateAuthoredDocument(document);
  if (result.success) throw new Error('fixture validates; this test needs one that does not');
  return result.error.issues;
}

/** The candidate entry line for `file`, found by the file name and its type. */
function entryIndex(file: string): number {
  const index = plainLines().findIndex((l) => /^ {3}\S/.test(l) && l.includes(`${file} (type "`));
  if (index < 0) throw new Error(`${file} is not listed as a file that did not validate`);
  return index;
}

/** The line printed directly under that entry — its issue line. */
function issueLineUnder(file: string): string {
  return plainLines()[entryIndex(file) + 1] ?? '';
}

/** Every printed line that could read as a pass. */
function passLines(): string[] {
  return plainLines().filter((l) => /pass/i.test(l));
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'objectui-check-first-issue-'));
  lines = [];
  exitCodes = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCodes.push(code ?? 0);
    return undefined as never;
  }) as never);
  restoreLog = () => {
    console.log = original;
    exitSpy.mockRestore();
  };
});

afterEach(() => {
  restoreLog();
  rmSync(cwd, { recursive: true, force: true });
});

describe('objectui check — a file that did not validate carries its first issue', () => {
  it('prints the refused key and the path it sits at, under the root typo', async () => {
    // The precondition, asserted rather than assumed: the validator refuses
    // this block by naming the key at the `map` block. If this fires, the
    // strict `map` block (objectui#5157) moved, and the fixture needs re-reading.
    const issues = issuesOf(ROOT_TYPO);
    expect(issues.map((i) => ({ code: i.code, path: i.path }))).toEqual([
      { code: 'unrecognized_keys', path: MAP_PATH },
    ]);

    // Named `stores.json`, not `map.json`, so the path `map` can only be read
    // off the issue line and never off the file name.
    writeSchema('stores.json', ROOT_TYPO);
    await check(cwd);

    const line = issueLineUnder('stores.json');
    expect(line).toContain(TYPO_KEY);
    expect(line).toContain(` ${formatIssuePath(MAP_PATH)}: `);
    expect(line.trim()).toBe(describeFirstIssue(issues));
    // Advisory, as before: listing the file does not fail the run.
    expect(exitCodes).toEqual([]);
  });

  it('spells a nested path the way `objectui validate` prints it', async () => {
    // A first issue two segments deep, so the join is exercised and not just
    // a single key. The spelling comes from `formatIssuePath`, the formatter
    // behind `objectui validate`'s `Path:` line.
    const document = {
      type: 'object-map',
      properties: { objectName: 'stores', map: { latitudeField: 'lat', longitudeField: 'lng', zoom: 'far' } },
    };
    const issues = issuesOf(document);
    expect(issues[0].path).toEqual([...MAP_PATH, 'zoom']);

    writeSchema('zoom.json', document);
    await check(cwd);

    expect(issueLineUnder('zoom.json')).toContain(formatIssuePath([...MAP_PATH, 'zoom']));
    expect(issueLineUnder('zoom.json').trim()).toBe(describeFirstIssue(issues));
  });

  it('says how many issues there were when it shows only the first', async () => {
    const document = {
      type: 'object-map',
      properties: { objectName: 'stores', map: { [TYPO_KEY]: 'lat', longitudeField: 'lng', zoom: 'far' } },
    };
    const issues = issuesOf(document);
    expect(issues.length).toBeGreaterThan(1);

    writeSchema('two.json', document);
    await check(cwd);

    const line = issueLineUnder('two.json');
    expect(line).toContain(String(issues.length));
    expect(line.trim()).toBe(describeFirstIssue(issues));
  });

  it('keeps one entry per file — the issue line is not counted as another file', async () => {
    writeSchema('stores.json', ROOT_TYPO);
    writeSchema('small.json', { type: 'text', content: 'Small text', variant: 'small' });
    await check(cwd);
    // The shape the sibling suites read entries by: three-space indent, then
    // the file. The issue lines sit deeper and must not match it.
    const entries = plainLines().filter((l) => /^ {3}\S.*\(type "/.test(l));
    expect(entries).toHaveLength(2);
    expect(issueLineUnder('small.json').trim()).toBe(
      describeFirstIssue(issuesOf({ type: 'text', content: 'Small text', variant: 'small' })),
    );
  });
});

describe('objectui check — the closing line is a tally, never a pass', () => {
  it('does not report the nested typo as passed', async () => {
    // The precondition: the document IS invalid — `objectui validate` refuses
    // it. `check` admits it on `children` without parsing it.
    expect(validateAuthoredDocument(NESTED_TYPO).success).toBe(false);

    writeSchema('page.json', NESTED_TYPO);
    await check(cwd);

    expect(passLines()).toEqual([]);
    expect(plainLines()).toContain(
      closingLine({ validated: 0, notValidated: 1, didNotValidate: 0 }),
    );
    // Still advisory: the exit code does not move.
    expect(exitCodes).toEqual([]);
  });

  it('counts each bucket apart in one run', async () => {
    writeSchema('leaf.json', { type: 'statistic', label: 'Total', value: '1' }); // validated
    writeSchema('clean-map.json', ROOT_CLEAN); // validated
    writeSchema('page.json', NESTED_TYPO); // recognised on `children`, not validated
    writeSchema('stores.json', ROOT_TYPO); // did not validate
    writeSchema('package.json', { name: 'x', type: 'module' }); // skipped: in no bucket
    await check(cwd);

    expect(plainLines()).toContain(
      closingLine({ validated: 2, notValidated: 1, didNotValidate: 1 }),
    );
    expect(passLines()).toEqual([]);
    expect(exitCodes).toEqual([]);
  });

  it('keeps the parse-error close as it was', async () => {
    // The other branch of the close is untouched: unreadable JSON fails the run
    // (as a refused `${…}` expression does, objectui#4795), and the tally is not
    // printed over it.
    writeFileSync(join(cwd, 'broken.json'), '{ "type": "card", "children": [ }');
    await check(cwd);
    expect(plainLines()).toContain('Found 1 errors');
    // The file never parsed, so it is in no bucket: had the tally printed, it
    // would have been this one.
    expect(plainLines()).not.toContain(
      closingLine({ validated: 0, notValidated: 0, didNotValidate: 0 }),
    );
    expect(exitCodes).toEqual([1]);
  });
});

describe('objectui check — no nested walk of its own (triage ruling on objectui#11007)', () => {
  it('counts a broken page and a clean page the same way, because it validates neither', async () => {
    // ⛔ If this goes red because `check` now tells these two apart, a walk was
    // added. The ruling on objectui#11007 declined exactly that: it would
    // duplicate `objectui validate`, whose verdict this command points to.
    // The control that makes the pair meaningful: the validator DOES tell them
    // apart.
    expect(validateAuthoredDocument(NESTED_TYPO).success).toBe(false);
    expect(validateAuthoredDocument(NESTED_CLEAN).success).toBe(true);

    writeSchema('broken-page.json', NESTED_TYPO);
    writeSchema('clean-page.json', NESTED_CLEAN);
    await check(cwd);

    expect(plainLines()).toContain(
      closingLine({ validated: 0, notValidated: 2, didNotValidate: 0 }),
    );
    expect(plainLines().filter((l) => l.includes(TYPO_KEY))).toEqual([]);
  });
});
