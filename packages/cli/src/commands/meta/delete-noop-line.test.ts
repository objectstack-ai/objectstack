// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23479] `os meta delete`'s human line follows the reset door's `reset` —
 * the same fact the `--format json` / `--format yaml` arms lower into
 * `deleted` — and the exit code is the same on every arm, for both values.
 *
 * ## The defect this file would have caught
 *
 * The human arm printed `✓ Metadata deleted: <type>/<name>` without reading
 * `result.reset`. So `os meta delete view nothing_here` claimed a deletion on
 * the very call whose JSON face answered `deleted: false`, and so did
 * `--package <id>` naming a package that holds no row of the item.
 *
 * ## Why the door's answer is canned here, and why that is legitimate
 *
 * The claim under test is a fact about THIS command: handed a `reset: false`
 * receipt, it must not claim a deletion. That the real door answers
 * `reset: false` on both repros is already pinned against the real stack in
 * `delete-reset-carriers.test.ts` (`deleted: false` for a `--package` that
 * holds no row; exit `0` for a `--draft` reset of an item with no draft).
 * The bodies below are the door's own no-op and delete-ful receipts
 * (`ObjectStackProtocolImplementation.deleteMetaItem`'s returns), and the
 * POSITIVE CONTROL measures that such a body survives the real SDK verbatim —
 * if it ever stopped doing so, that case goes red first and the rest of this
 * file would be measuring a fiction.
 *
 * ## The exit code is pinned in BOTH directions, deliberately
 *
 * `0` on both values, on all three arms — the code the machine arms already
 * exit with while publishing `success: true` beside `deleted: false`. A
 * transport failure still exits `1`: the control that shows `0` on a no-op is
 * a decision, not the command having lost the ability to fail.
 *
 * ## Why every case carries an explicit 60s budget
 *
 * Same reason the sibling `delete-*.test.ts` files state: each case drives a
 * real `Command.run` against the real oclif root, measured timing out at
 * vitest's 5s default inside this package's full suite on a shared container.
 * The budget is wall-clock only; no assertion moves with it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { ObjectStackClient } from '@objectstack/client';
import MetaDelete from './delete.js';

const stub = vi.hoisted(() => ({
  client: undefined as any,
  token: 'test-token' as string | undefined,
}));

vi.mock('../../utils/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/api-client.js')>();
  return {
    ...actual,
    createApiClient: async () => ({ client: stub.client, token: stub.token }),
  };
});

/** `packages/cli` — the oclif root the command is loaded against. */
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * The escape is written as `\x1b`, never as the byte itself: one raw control
 * character makes grep treat the whole file as binary.
 */
const SGR = /\x1b\[[0-9;]*m/g;
const plain = (s: string) => s.replace(SGR, '');

const TYPE = 'view';
const NAME = 'nothing_here';
const REF = `${TYPE}/${NAME}`;
const PKG = 'com.qa.gamma';

/**
 * Every sentence, in full. Pinned whole rather than by substring: a reword is
 * a change to what an operator reads, and must fail here rather than slip
 * through a `toContain('deleted')` that both sentences satisfy.
 */
const DELETED_LINE = `  ✓ Metadata deleted: ${REF}`;
const DRAFT_DISCARDED_LINE = `  ✓ Pending draft discarded: ${REF}`;
const NOOP_LINE = `  ⚠ Nothing deleted: ${REF} — the server found nothing to delete`;
const NOOP_PACKAGE_LINE = `  ⚠ Nothing deleted: package '${PKG}' holds no row of ${REF}`;
const NOOP_DRAFT_LINE = `  ⚠ Nothing discarded: ${REF} has no pending draft`;
const NOOP_DRAFT_PACKAGE_LINE = `  ⚠ Nothing discarded: package '${PKG}' holds no pending draft of ${REF}`;

/** One run's argv shape, the sentence each `reset` value earns under it. */
interface Variant {
  label: string;
  flags: string[];
  deleted: string;
  noOp: string;
}

const VARIANTS: Variant[] = [
  { label: 'no flag', flags: [], deleted: DELETED_LINE, noOp: NOOP_LINE },
  { label: '--package', flags: ['--package', PKG], deleted: DELETED_LINE, noOp: NOOP_PACKAGE_LINE },
  { label: '--draft', flags: ['--draft'], deleted: DRAFT_DISCARDED_LINE, noOp: NOOP_DRAFT_LINE },
  {
    label: '--draft --package',
    flags: ['--draft', '--package', PKG],
    deleted: DRAFT_DISCARDED_LINE,
    noOp: NOOP_DRAFT_PACKAGE_LINE,
  },
];

interface CliRun {
  out: string;
  exitCode: number;
}

async function runCli(argv: string[]): Promise<CliRun> {
  const chunks: string[] = [];
  const logSpy = vi
    .spyOn(console, 'log')
    .mockImplementation((...args: unknown[]) => { chunks.push(args.map(String).join(' ')); });
  // `emitText` awaits `stdout.write`'s callback — a stub that swallows it
  // HANGS rather than failing, and the case dies at its own timeout.
  const writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((chunk: unknown, encodingOrCb?: unknown, maybeCb?: unknown) => {
      chunks.push(String(chunk));
      const done = typeof encodingOrCb === 'function' ? encodingOrCb : maybeCb;
      if (typeof done === 'function') (done as (err?: Error | null) => void)(null);
      return true;
    }) as never);
  const savedExitCode = process.exitCode;
  process.exitCode = undefined;
  let exitCode = 0;
  try {
    await MetaDelete.run(argv, { root: CLI_ROOT });
  } catch (error: unknown) {
    const oclif = (error as { oclif?: { exit?: number } })?.oclif;
    exitCode = typeof oclif?.exit === 'number' ? oclif.exit : 1;
  } finally {
    // Both doors out of this command move the code, and only one of them
    // throws: `this.exit(n)` throws an oclif `ExitError`, while `emitText`
    // sets `process.exitCode` in place and returns normally. Reading only the
    // thrown one would pin a `0` that the process never actually exits with.
    if (exitCode === 0 && typeof process.exitCode === 'number') exitCode = process.exitCode;
    logSpy.mockRestore();
    writeSpy.mockRestore();
    process.exitCode = savedExitCode;
  }
  return { out: plain(chunks.join('\n')), exitCode };
}

/** A client whose `fetch` answers with one canned response, body and status verbatim. */
function clientAnswering(status: number, body: unknown): ObjectStackClient {
  return new ObjectStackClient({
    baseUrl: 'https://door.test',
    token: 'test-token',
    fetch: async () => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      json: async () => body,
      headers: new Headers(),
    }) as any,
  });
}

/**
 * The reset door's receipt, either way. Shapes and sentences are the door's
 * own: a delete-ful return carries `seq`, a no-op return carries none.
 */
const receipt = (reset: boolean) => (reset
  ? { success: true, reset: true, seq: 7, message: `Deleted view '${NAME}' — it no longer exists. [seq=7]` }
  : { success: true, reset: false, message: `No view '${NAME}' found — nothing to delete.` });

/**
 * What the human arm STATES about the reset, for one variant.
 *
 * Refuses to answer when the arm said neither of the variant's two sentences
 * or both — the failure mode a bare "does not contain `Metadata deleted`"
 * assertion is satisfied by is a command that prints nothing at all.
 */
function humanClaim(out: string, variant: Variant): boolean {
  const saysDeleted = out.includes(variant.deleted);
  const saysNoOp = out.includes(variant.noOp);
  if (saysDeleted === saysNoOp) {
    throw new Error(
      `[${variant.label}] the human arm stated neither known sentence, or both: ${JSON.stringify(out)}`,
    );
  }
  return saysDeleted;
}

afterEach(() => {
  stub.client = undefined;
  stub.token = 'test-token';
});

describe('[#23479] `os meta delete` — the human line follows the door\'s `reset`', () => {
  it('POSITIVE CONTROL — both receipts reach the command through the REAL SDK, verbatim', async () => {
    // One frame earlier than the command. If the SDK normalised, threw on, or
    // swallowed the flag, every assertion below would be about a value that
    // can never arrive.
    const noOp = await clientAnswering(200, receipt(false)).meta.deleteItem(TYPE, NAME);
    expect(noOp).toEqual(receipt(false));
    expect(noOp.reset).toBe(false);
    // …and the delete-ful receipt arrives just as verbatim, so the control
    // above is not measuring a path that mangles everything equally.
    const deleted = await clientAnswering(200, receipt(true)).meta.deleteItem(TYPE, NAME);
    expect(deleted).toEqual(receipt(true));
    expect(deleted.reset).toBe(true);
  }, 60_000);

  it('`reset: true` — the success line, byte for byte, on every variant', async () => {
    for (const variant of VARIANTS) {
      stub.client = clientAnswering(200, receipt(true));
      const run = await runCli([TYPE, NAME, ...variant.flags]);
      // The WHOLE output: an added line or a reword is a change to what an
      // operator reads. `--package` leaves the success line as it was.
      expect({ label: variant.label, out: run.out, exitCode: run.exitCode })
        .toEqual({ label: variant.label, out: variant.deleted, exitCode: 0 });
      // NEGATIVE CONTROL: the no-op wording is absent on the delete-ful run.
      expect(run.out).not.toContain('Nothing deleted');
      expect(run.out).not.toContain('Nothing discarded');
    }
  }, 60_000);

  it('`reset: false` — the no-op line, and NOT the success line', async () => {
    for (const variant of VARIANTS) {
      stub.client = clientAnswering(200, receipt(false));
      const run = await runCli([TYPE, NAME, ...variant.flags]);
      expect({ label: variant.label, out: run.out, exitCode: run.exitCode })
        .toEqual({ label: variant.label, out: variant.noOp, exitCode: 0 });
      // NEGATIVE CONTROL: the two success sentences that were the defect,
      // named so a future reader sees what this case guards — and no success
      // glyph at all.
      expect(run.out).not.toContain('Metadata deleted');
      expect(run.out).not.toContain('Pending draft discarded');
      expect(run.out).not.toContain('✓');
    }
  }, 60_000);

  it('`--package P` names P, verbatim, and only on the no-op line', async () => {
    // The package-less no-op line must not stand in for the named one: the
    // operator who named a package learns that THIS package holds no row.
    stub.client = clientAnswering(200, receipt(false));
    const named = await runCli([TYPE, NAME, '--package', PKG]);
    expect(named.out).toContain(`'${PKG}'`);
    expect(named.out).not.toBe(NOOP_LINE);

    // NEGATIVE CONTROL: without `--package`, no package is named — the
    // sentence never claims a package the command did not send.
    stub.client = clientAnswering(200, receipt(false));
    const unnamed = await runCli([TYPE, NAME]);
    expect(unnamed.out).not.toContain(PKG);
    expect(unnamed.out).not.toContain('package');

    // Forwarded verbatim, so quoted verbatim: the id is the door's to judge.
    stub.client = clientAnswering(200, receipt(false));
    const padded = await runCli([TYPE, NAME, '--package', ' com.qa.gamma ']);
    expect(padded.out).toBe(`  ⚠ Nothing deleted: package ' com.qa.gamma ' holds no row of ${REF}`);
  }, 60_000);

  it('all three arms state the SAME fact, for one and the same receipt', async () => {
    for (const variant of VARIANTS) {
      for (const reset of [true, false]) {
        stub.client = clientAnswering(200, receipt(reset));
        const json = await runCli([TYPE, NAME, ...variant.flags, '--format', 'json']);
        stub.client = clientAnswering(200, receipt(reset));
        const asYaml = await runCli([TYPE, NAME, ...variant.flags, '--format', 'yaml']);
        stub.client = clientAnswering(200, receipt(reset));
        const human = await runCli([TYPE, NAME, ...variant.flags]);

        const jsonPayload = JSON.parse(json.out);
        const yamlPayload = yaml.parse(asYaml.out);

        // The fact under test is `deleted`, NOT the envelope's `success` —
        // the two booleans the command's own `[#13023]` note refuses to
        // conflate.
        expect({ label: variant.label, facts: [jsonPayload.deleted, yamlPayload.deleted, humanClaim(human.out, variant)] })
          .toEqual({ label: variant.label, facts: [reset, reset, reset] });

        // The envelope flag is the command-completed flag and stays `true`;
        // if it ever starts tracking the reset, the line above would keep
        // passing while the payload changed meaning.
        expect(jsonPayload.success).toBe(true);
        expect(yamlPayload.success).toBe(true);
      }
    }
  }, 60_000);

  it('the exit code is `0` on BOTH values and all three formats', async () => {
    for (const reset of [true, false]) {
      for (const format of [[], ['--format', 'json'], ['--format', 'yaml']]) {
        for (const variant of VARIANTS) {
          stub.client = clientAnswering(200, receipt(reset));
          const run = await runCli([TYPE, NAME, ...variant.flags, ...format]);
          expect({ reset, format, label: variant.label, exitCode: run.exitCode })
            .toEqual({ reset, format, label: variant.label, exitCode: 0 });
        }
      }
    }
  }, 60_000);

  it('a genuine transport failure still exits 1 — the no-op arm did not swallow the error path', async () => {
    // The control for the pin above: `0` on a no-op is a decision, not this
    // command having lost the ability to fail.
    stub.client = clientAnswering(500, { error: 'upstream exploded' });
    const run = await runCli([TYPE, NAME]);

    expect(run.exitCode).toBe(1);
    expect(run.out).toContain('upstream exploded');
    expect(run.out).not.toContain('Metadata deleted');
    expect(run.out).not.toContain('Nothing deleted');
  }, 60_000);
});
