/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectui check`'s positive schema marker (objectui#5127).
 *
 * A root `type` is not evidence that a file is a UI schema — `type` heads at
 * least seven unrelated JSON vocabularies, and the most common of them is
 * `package.json`'s `"type": "module"`. The command judged all of them, so the
 * FIRST line a user saw running it in their own project was a warning about
 * their own package manifest: 45 of the 46 warnings this repository produced
 * were exactly that.
 *
 * Half of this file pins that those files stopped being judged. The OTHER half
 * pins that real schemas are still judged and still warn — a suite that only
 * proved things went quiet would pass a change that deleted the feature, which
 * is the failure mode this gate is one step away from by construction.
 *
 * Fixtures live under `os.tmpdir()`, never in the repo tree: `check()` globs
 * every JSON file under the directory it is handed, so a fixture committed
 * inside this workspace would be scanned by every other run of the command as
 * well — including the repo's own `pnpm check`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { check, closingLine } from '../commands/check.js';

let cwd: string;
let lines: string[];
let exitCodes: number[];
let restoreLog: () => void;

function writeSchema(name: string, body: unknown): void {
  writeFileSync(join(cwd, name), JSON.stringify(body));
}

/** Write a fixture verbatim — for JSONC sources, not `JSON.stringify` output. */
function writeRaw(name: string, body: string): void {
  writeFileSync(join(cwd, name), body);
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

function unknownTypeWarnings(): string[] {
  return plainLines().filter((l) => l.includes('Unknown schema type'));
}

/** The advisory line `check` prints under the skipped-file count. */
function hintLine(): string {
  const line = plainLines().find((l) => l.includes('A file is checked when'));
  if (line === undefined) throw new Error('no hint line was printed');
  return line;
}

/**
 * The marker keys the hint advertises to the reader, read back out of the
 * printed sentence rather than restated here — so a test can check that what
 * the command SAYS and what it DOES are the same set.
 */
function advertisedKeys(): string[] {
  const match = /structural key: (.+)\.$/.exec(hintLine());
  if (!match) throw new Error(`hint present but unparseable: ${hintLine()}`);
  return match[1].split(', ');
}

/**
 * The per-file lines of the unvalidated-candidate report (objectui#6075) — the
 * bucket that exists so a broken ObjectUI file is never filed as a foreign one.
 */
function candidateLines(): string[] {
  return plainLines().filter((l) => /^ {3}\S.*\(type "/.test(l));
}

/** The headline count of that report, or 0 when it did not print. */
function candidateCount(): number {
  const line = plainLines().find((l) => l.includes('did not validate as an ObjectUI schema'));
  if (!line) return 0;
  const match = /(\d+) files? carr/.exec(line);
  if (!match) throw new Error(`candidate line present but unparseable: ${line}`);
  return Number(match[1]);
}

/** The count `check` reports for files it declined to judge, or 0 if silent. */
function skippedCount(): number {
  const line = plainLines().find((l) => l.startsWith('Skipped '));
  if (!line) return 0;
  const match = /^Skipped (\d+) file/.exec(line);
  if (!match) throw new Error(`skip line present but unparseable: ${line}`);
  return Number(match[1]);
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'objectui-check-marker-'));
  lines = [];
  exitCodes = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  // `check()` calls `process.exit(1)` itself; record the call instead of
  // letting it tear the Vitest worker down.
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

describe('objectui check — foreign root-`type` vocabularies are never judged', () => {
  it('says nothing about `package.json`\'s "type": "module" — the card\'s headline symptom', async () => {
    writeSchema('package.json', { name: 'x', version: '1.0.0', type: 'module' });
    await check(cwd);
    expect(unknownTypeWarnings()).toEqual([]);
  });

  it('says nothing about a JSON Schema document', async () => {
    // Two documents. `array` is not registered, so the array document is one
    // that genuinely warned before the marker landed.
    //
    // objectui#6075 split what used to be one bucket, and while `object` was a
    // registered key the draft-07 document landed in the unvalidated-candidate
    // report rather than the skipped count — the ONE false positive that
    // discriminator had, pinned here as a known, one-line cost. objectui#10859
    // batch 8 retired the bare `object` key (a `@object-ui/fields` fallback that
    // no document authored as a node), so that false positive is gone: both
    // documents are now skipped. Neither document is JUDGED, which is what this
    // suite is about.
    //
    // Note the array document carries `items`, which is why `items` is absent
    // from the structural-key set even though ObjectUI nodes use it: a marker
    // key shared with JSON Schema re-admits exactly the files this gate exists
    // to keep out.
    writeSchema('thing.schema.json', {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'Thing',
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    });
    writeSchema('tags.schema.json', {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'Tags',
      type: 'array',
      items: { type: 'string' },
    });
    await check(cwd);
    expect(unknownTypeWarnings()).toEqual([]);
    // Both documents are unrecognisable by every arm, and neither root type is
    // registered: both skipped, none reported as a candidate.
    expect(skippedCount()).toBe(2);
    expect(candidateCount()).toBe(0);
    expect(candidateLines()).toEqual([]);
  });

  it('says nothing about a deployment resource descriptor', async () => {
    // The third big root-`type` vocabulary after package manifests and JSON
    // Schema: infrastructure resources. `properties` is deliberately not a
    // marker key, so this file is not admitted by the structural arm.
    writeSchema('bucket.json', {
      type: 'aws:s3/bucket:Bucket',
      properties: { acl: 'private' },
    });
    await check(cwd);
    expect(unknownTypeWarnings()).toEqual([]);
    expect(skippedCount()).toBe(1);
  });

  it('never even sees a dot-prefixed config — those are outside the scan', async () => {
    // `.eslintrc.json` is the obvious fixture for this suite and it would be a
    // PHANTOM: `globSync` does not match dot-prefixed names without `dot: true`,
    // so the file is not scanned at all and an assertion of silence over it
    // holds whatever the marker does. Measured, and it is why this test asserts
    // the scope rather than the marker.
    //
    // The scanned sibling is the counter-probe: without it, "no warnings" here
    // would be indistinguishable from a scan that read nothing.
    writeSchema('.eslintrc.json', { root: true, type: 'totally-made-up-xyz', rules: {} });
    writeSchema('page.json', { type: 'totally-made-up-xyz', children: [] });
    await check(cwd);
    // Exactly one warning, from the scanned file — the dotfile contributed
    // neither a warning nor a skip.
    expect(unknownTypeWarnings()).toEqual([
      expect.stringContaining('Unknown schema type "totally-made-up-xyz" in page.json'),
    ]);
    expect(skippedCount()).toBe(0);
  });

  it('says nothing about a tsconfig-derived file, and does not count it as skipped', async () => {
    // A `tsconfig` carries no root `type` at all, so it was never ELIGIBLE for
    // judgement and must not inflate the skipped count either — that count
    // reports lost coverage, and a file that was never judged is not lost
    // coverage. It is written as real JSONC to keep the objectui#5237 parse
    // arm exercised alongside this one.
    writeRaw(
      'tsconfig.build.json',
      '{\n  // extends the base config\n  "extends": "./tsconfig.json",\n  "compilerOptions": { "outDir": "dist" },\n}\n'
    );
    await check(cwd);
    expect(unknownTypeWarnings()).toEqual([]);
    expect(skippedCount()).toBe(0);
    expect(exitCodes).toEqual([]);
  });

  it('does not judge a foreign file even when its `type` happens to name a real component', async () => {
    // `form` IS a registered component key, so this file was silent before the
    // marker too — but for the wrong reason. Pinning it keeps the gate honest:
    // the file is out of scope, not accidentally acceptable.
    //
    // The load-bearing assertion is the first one: NOT JUDGED. A manifest whose
    // `type` collides with a component key is refused by both recogniser arms —
    // the structural arm sees no ObjectUI key, and the validity arm rejects it
    // because a `FormSchema` needs more than a name. That the collision then
    // costs one advisory line in the unvalidated-candidate report is the
    // measured price of using the registered-type universe as the
    // report/skip discriminator (objectui#6075), recorded here rather than
    // discovered later. ⛔ The alternative — exempting files called
    // `package.json` — is the filename skip list this gate was built to avoid.
    writeSchema('package.json', { name: 'x', type: 'form' });
    await check(cwd);
    expect(unknownTypeWarnings()).toEqual([]);
    expect(candidateCount()).toBe(1);
    expect(skippedCount()).toBe(0);
  });
});

describe('objectui check — a real schema is still judged by the structural arm', () => {
  it('judges a file carrying a structural key, with no `$schema` at all', async () => {
    writeSchema('page.json', {
      type: 'totally-made-up-xyz',
      children: [{ type: 'text', body: 'hi' }],
    });
    await check(cwd);
    expect(unknownTypeWarnings()).toHaveLength(1);
    expect(unknownTypeWarnings()[0]).toContain('"totally-made-up-xyz"');
  });

  it('stays silent for a REGISTERED type on a judged file — the marker admits, it does not warn', async () => {
    writeSchema('grid.json', { type: 'object-grid', className: 'h-full' });
    writeSchema('ns-grid.json', { type: 'view:grid', body: [] });
    await check(cwd);
    expect(unknownTypeWarnings()).toEqual([]);
    expect(skippedCount()).toBe(0);
  });

  it('does not admit a file on `$schema` alone — no URL is a marker', async () => {
    // ⛔ NEGATIVE fixtures. ObjectUI publishes NO `$schema` URL, and none is
    // being minted: the maintainer ruled against it (2026-08-20, verbatim
    // 「C」), superseding the `$schema` half of the 2026-08-19 ruling. An
    // earlier revision of this command admitted any file whose `$schema` host
    // was `objectui.org`; these two files pin that that arm is GONE, so
    // re-adding it turns this test red rather than passing unnoticed.
    //
    // The paths below are arbitrary on purpose — no spelling of an ObjectUI
    // schema URL means anything to this command, which is the whole point.
    writeSchema('declared.json', {
      $schema: 'https://objectui.org/some/path.json',
      type: 'totally-made-up-xyz',
    });
    writeSchema('relative.json', { $schema: './objectui-schema.json', type: 'totally-made-up-xyz' });
    // Counter-probe: the same unregistered type, admitted structurally. Its
    // warning proves the two silences above are the gate declining these
    // files, not a run that judged nothing.
    writeSchema('probe.json', { type: 'totally-made-up-xyz', children: [] });
    await check(cwd);
    expect(unknownTypeWarnings()).toEqual([
      expect.stringContaining('Unknown schema type "totally-made-up-xyz" in probe.json'),
    ]);
    expect(skippedCount()).toBe(2);
  });
});

describe('objectui check — the narrowed judgement surface is never silent (option D)', () => {
  it('reports how many eligible files went unjudged, and how to opt one in', async () => {
    writeSchema('package.json', { name: 'x', type: 'module' });
    // The two leaves are the majority shape of the real in-repo corpus: a
    // single node with no structural key. They used to be counted as lost
    // coverage here — that was the recall debt objectui#6075 tracked, and the
    // validity arm repays it: both now VALIDATE as ObjectUI components and are
    // judged, so only the manifest remains unrecognised. The assertion is
    // deliberately still a count of what went unjudged; what changed is which
    // files are in it.
    writeSchema('leaf-1.json', { type: 'button', label: 'Send Email', icon: 'mail' });
    writeSchema('leaf-2.json', { type: 'badge', variant: 'default' });
    await check(cwd);
    // The manifest alone. Both leaves are recognised now, and neither is a
    // candidate: they validate.
    expect(skippedCount()).toBe(1);
    expect(candidateCount()).toBe(0);
    const hint = hintLine();
    expect(hint).toContain('children');
    expect(hint).toContain('className');
    // ⛔ The hint must not advise declaring a `$schema` URL: no such URL exists
    // and no arm reads one (maintainer ruling 2026-08-20, verbatim 「C」). A
    // hint naming a way in the build does not honour is worse than no hint —
    // the reader follows it, nothing changes, and the command reads as broken
    // rather than narrow. This is the "comment claims != code enforces" shape,
    // pinned so the sentence cannot outlive the code it describes.
    expect(hint).not.toContain('$schema');
    expect(hint).not.toContain('http');
  });

  it('names only markers the gate actually honours — every key in the hint admits a file', async () => {
    // The mechanical version of the assertion above. The hint is READ back and
    // each key it advertises is fed to the command on its own file: if the
    // sentence ever names a key the gate does not honour, that file is skipped
    // and this test goes red. Nothing here restates the key set by hand, so it
    // cannot drift from the gate the way a duplicated list would.
    writeSchema('package.json', { name: 'x', type: 'module' });
    await check(cwd);
    const keys = advertisedKeys();
    // Sanity: the hint advertises a real set, not an empty one.
    expect(keys.length).toBeGreaterThan(0);

    // The manifest has served its purpose (it made the hint print); leave it in
    // place and it would keep counting as a skipped file in the second run.
    rmSync(join(cwd, 'package.json'));
    lines = [];
    for (const [i, key] of keys.entries()) {
      writeSchema(`node-${i}.json`, { type: 'totally-made-up-xyz', [key]: 'x' });
    }
    await check(cwd);
    // Every advertised key admitted its file, so every file was judged and
    // warned; none was skipped.
    expect(unknownTypeWarnings()).toHaveLength(keys.length);
    expect(skippedCount()).toBe(0);
  });

  it('says nothing when every eligible file carried a marker', async () => {
    writeSchema('page.json', { type: 'card', children: [] });
    await check(cwd);
    expect(skippedCount()).toBe(0);
    expect(plainLines().some((l) => l.startsWith('Skipped '))).toBe(false);
  });

  it('is a report, not a failure — the run still passes', async () => {
    writeSchema('package.json', { name: 'x', type: 'module' });
    await check(cwd);
    expect(skippedCount()).toBe(1);
    // The no-error close (objectui#11007). A skipped file is in none of its
    // buckets: it was not recognised as ObjectUI at all.
    expect(plainLines()).toContain(
      closingLine({ validated: 0, notValidated: 0, didNotValidate: 0 })
    );
    expect(exitCodes).toEqual([]);
  });
});

describe('objectui check — the marker gate did not disturb the parse arm', () => {
  it('still counts malformed JSON as an error and still exits 1', async () => {
    writeRaw('broken.json', '{ "type": "card", "children": [ }');
    await check(cwd);
    expect(plainLines().some((l) => l.includes('Invalid JSON in broken.json'))).toBe(true);
    expect(plainLines().some((l) => l.includes('Found 1 errors'))).toBe(true);
    expect(exitCodes).toEqual([1]);
  });
});
