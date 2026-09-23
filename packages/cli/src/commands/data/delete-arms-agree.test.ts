// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19413] `os data delete`'s three output arms state the SAME fact about the
 * same row — and the exit code is the same on every one of them.
 *
 * ## The defect this file would have caught
 *
 * `--format json` and `--format yaml` lower the server's
 * `DeleteDataResponse.success` into their own `deleted` key (that is what
 * #5638 landed, and its note is still in the command). The default
 * human-readable arm printed `Record deleted: <id>` **unconditionally**. One
 * command, one call, two output formats that can state opposite facts about
 * whether a row is gone.
 *
 * ## Why the `false` case is forced at the WIRE, and why that is legitimate
 *
 * On today's `main` the single-record delete door cannot answer
 * `success: false` at all: `MetadataProtocol.deleteData` returns the literal
 * `success: true` and turns the driver's `false` into a 404. PR #19411 is the
 * change that first lets a real server answer `false` here, and it is open and
 * still a draft — so this file must NOT depend on it, and does not: nothing
 * here imports from that branch or asserts anything about the server.
 *
 * What it asserts is a fact about THIS command: handed a `success: false`
 * response, it must not claim a deletion. That fact is testable today because
 * the seam is the HTTP response, and the first case measures — rather than
 * assumes — that a `success: false` body survives the real SDK unchanged.
 * `unwrapResponse` strips an envelope only when the body carries BOTH a
 * boolean `success` and a `data` key, so the flat delete payload passes
 * through verbatim; the `fetch` wrapper throws only on a non-2xx status. If
 * either of those ever stopped holding, the POSITIVE CONTROL below goes red
 * first, and the rest of this file would be measuring a fiction.
 *
 * ## The exit code is pinned in BOTH directions, deliberately
 *
 * The chosen behaviour is exit `0` on both arms — the same code the two
 * machine arms already exit with while publishing `deleted: false`. The pin
 * exists because the alternative (non-zero on the not-deleted arm) narrows a
 * published CLI accept set: a script that succeeds today would start failing.
 * An unpinned exit code is how that moves without anyone noticing, in either
 * direction, so both are written down here rather than left to a later reading
 * of the source.
 *
 * ## Why every case carries an explicit 60s budget
 *
 * Same reason the two `commands/meta/delete-*.test.ts` files state: the budget
 * is wall-clock only and no assertion moves with it. Each case drives a real
 * `Command.run` against the real oclif root, which resolves the plugin and
 * manifest surface before the command body runs — measured at well under a
 * second on an idle box, and measured timing out at vitest's 5s default when
 * such a file runs inside this package's full suite on a shared container.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { ObjectStackClient } from '@objectstack/client';
import DataDelete from './delete.js';

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

const OBJECT = 'task';
const ID = 'rec_1';

/**
 * The two sentences, in full. Pinned whole rather than by substring: a reword
 * of either one is a change to what an operator reads, and must fail here
 * rather than slip through a `toContain('deleted')` that both sentences
 * satisfy.
 */
const DELETED_LINE = `  ✓ Record deleted: ${ID}`;
const NOT_DELETED_LINE =
  `  ⚠ Not deleted: ${ID} — the server reported the deletion did not happen`;

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
    await DataDelete.run(argv, { root: CLI_ROOT });
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

/** The delete door's wire payload, with the server's flag set either way. */
const wireBody = (success: boolean) => ({ object: OBJECT, id: ID, success });

/**
 * What the human arm STATES about the deletion.
 *
 * Refuses to answer when the arm said neither sentence or both — the failure
 * mode a bare "does not contain `Record deleted`" assertion is satisfied by is
 * a command that prints nothing at all.
 */
function humanClaim(out: string): boolean {
  const saysDeleted = out.includes(DELETED_LINE);
  const saysNotDeleted = out.includes(NOT_DELETED_LINE);
  if (saysDeleted === saysNotDeleted) {
    throw new Error(
      `the human arm stated neither known sentence, or both: ${JSON.stringify(out)}`,
    );
  }
  return saysDeleted;
}

afterEach(() => {
  stub.client = undefined;
  stub.token = 'test-token';
});

describe('[#19413] `os data delete` — every output arm states the same fact', () => {
  it('POSITIVE CONTROL — a `success: false` body reaches the command through the REAL SDK', async () => {
    // One frame earlier than the command. If the SDK normalised, threw on, or
    // swallowed this flag, the card's premise would be dead and every
    // assertion below would be about a value that can never arrive.
    const client = clientAnswering(200, wireBody(false));
    const result = await client.data.delete(OBJECT, ID);
    expect(result).toEqual({ object: OBJECT, id: ID, success: false });
    expect(result.success).toBe(false);

    // …and the true case arrives just as verbatim, so the control above is not
    // measuring a path that mangles everything equally.
    const truthy = await clientAnswering(200, wireBody(true)).data.delete(OBJECT, ID);
    expect(truthy).toEqual({ object: OBJECT, id: ID, success: true });
  }, 60_000);

  it('LIT CONTROL — `success: true` still prints today\'s sentence, byte for byte', async () => {
    stub.client = clientAnswering(200, wireBody(true));
    const run = await runCli([OBJECT, ID]);

    // The WHOLE output, not a substring: an added line or a reword is a change
    // to what an operator reads and belongs in a diff someone looked at.
    expect(run.out).toBe(DELETED_LINE);
    expect(run.exitCode).toBe(0);
  }, 60_000);

  it('`success: false` — the human arm does NOT assert a deletion', async () => {
    stub.client = clientAnswering(200, wireBody(false));
    const run = await runCli([OBJECT, ID]);

    expect(run.out).toBe(NOT_DELETED_LINE);
    // The specific sentence that was the defect, named so a future reader sees
    // what this file is guarding.
    expect(run.out).not.toBe(DELETED_LINE);
    expect(run.out).not.toContain('Record deleted');
  }, 60_000);

  it('all three arms state the SAME fact, for one and the same result', async () => {
    for (const wire of [true, false]) {
      stub.client = clientAnswering(200, wireBody(wire));
      const json = await runCli([OBJECT, ID, '--format', 'json']);
      stub.client = clientAnswering(200, wireBody(wire));
      const asYaml = await runCli([OBJECT, ID, '--format', 'yaml']);
      stub.client = clientAnswering(200, wireBody(wire));
      const human = await runCli([OBJECT, ID]);

      const jsonPayload = JSON.parse(json.out);
      const yamlPayload = yaml.parse(asYaml.out);

      // The fact under test is `deleted`, NOT the envelope's `success` — the
      // two booleans the command's own `[#5638]` note refuses to conflate.
      expect([jsonPayload.deleted, yamlPayload.deleted, humanClaim(human.out)])
        .toEqual([wire, wire, wire]);

      // The envelope flag is the command-completed flag and stays `true` on
      // both arms; if it ever starts tracking the deletion, the line above
      // would keep passing while the payload changed meaning.
      expect(jsonPayload.success).toBe(true);
      expect(yamlPayload.success).toBe(true);
      expect(jsonPayload.id).toBe(ID);
      expect(yamlPayload.object).toBe(OBJECT);
    }
  }, 60_000);

  it('the exit code is `0` on BOTH arms and all three formats', async () => {
    for (const wire of [true, false]) {
      for (const argv of [[OBJECT, ID], [OBJECT, ID, '--format', 'json'], [OBJECT, ID, '--format', 'yaml']]) {
        stub.client = clientAnswering(200, wireBody(wire));
        const run = await runCli(argv);
        expect({ wire, argv, exitCode: run.exitCode })
          .toEqual({ wire, argv, exitCode: 0 });
      }
    }
  }, 60_000);

  it('a genuine transport failure still exits 1 — the not-deleted arm did not swallow the error path', async () => {
    // The control for the pin above: `0` on a declined deletion is a decision,
    // not this command having lost the ability to fail.
    stub.client = clientAnswering(500, { error: 'upstream exploded' });
    const run = await runCli([OBJECT, ID]);

    expect(run.exitCode).toBe(1);
    expect(run.out).toContain('upstream exploded');
    expect(run.out).not.toContain('Record deleted');
  }, 60_000);
});
