// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13347] The ADR-0112 carriers survive the whole way to a `--format json`
 * failure envelope — and are ABSENT when the failure never carried them.
 *
 * ## Why this file drives the real command and the real SDK
 *
 * The unit pin (`utils/format.error-code-fields.test.ts`) asserts what
 * `errorCodeFields` does with an error SHAPED like the SDK's. That is a claim
 * about the builder, and it stays green even if the shape is a fiction — if
 * `err.code` never actually arrives populated in one of the 48 `catch` blocks,
 * the card's whole premise is dead and every unit case still passes.
 *
 * So the cases below start from a REAL HTTP response body and run the REAL
 * `@objectstack/client` `fetch` wrapper (the frame that builds the error), the
 * REAL oclif command, and the REAL `emitJson`. One seam is stubbed, and it is
 * the credential boundary rather than any part of the mechanism:
 * `createApiClient` — "the operator is logged in, and here is the server" —
 * replaced with a real `ObjectStackClient` whose `fetch` returns the response
 * instead of opening a socket.
 *
 * ## Both server dialects, because the code's SPELLING is the thing at risk
 *
 * `@objectstack/rest` answers flat (`{ error, code }`); the runtime dispatcher
 * answers wrapped (`{ success: false, error: { code, message, httpStatus } }`).
 * #3842 / #4007 made `err.code` the same semantic STRING on both. A pin that
 * exercised only one dialect would go green against a CLI that publishes the
 * numeric status under `code` on the other.
 *
 * ## The omission arm gets a control from the same population
 *
 * `os meta delete --if-match ''` is refused by `metaDeleteOptions` with a plain
 * `Error`, inside the same `try`, before a client exists. That is this CLI's
 * own input refusal — the case option **B** would have minted a code for, and
 * option **A** deliberately does not. The case asserts the emitted BYTES carry
 * neither key, and asserts `createApiClient` was never called, so "no code"
 * is measured on a genuinely local throw rather than on a network path that
 * happened not to run.
 *
 * ## Why every case carries an explicit 60s budget
 *
 * Not a slow test being papered over — the budget is wall-clock only and no
 * assertion moves with it. Each case drives a real `Command.run` against the
 * real oclif root, which resolves the plugin/manifest surface before the
 * command body runs; measured at ~0.8s per case on an idle box, and measured
 * TIMING OUT at vitest's 5s default when this file ran inside the package's
 * full 220-file suite on a shared container. A default-budget case here is a
 * test whose verdict depends on what else the box happens to be doing. The
 * neighbouring `delete-reset-carriers.test.ts` reaches the same conclusion for
 * the same reason and spells it the same way.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectStackClient } from '@objectstack/client';
import MetaDelete, { EMPTY_IF_MATCH_REFUSAL } from './delete.js';

const stub = vi.hoisted(() => ({
  client: undefined as any,
  token: 'test-token' as string | undefined,
  createCalls: 0,
}));

vi.mock('../../utils/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/api-client.js')>();
  return {
    ...actual,
    createApiClient: async () => {
      stub.createCalls += 1;
      return { client: stub.client, token: stub.token };
    },
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
  let exitCode = 0;
  try {
    await MetaDelete.run(argv, { root: CLI_ROOT });
  } catch (error: unknown) {
    const oclif = (error as { oclif?: { exit?: number } })?.oclif;
    exitCode = typeof oclif?.exit === 'number' ? oclif.exit : 1;
  } finally {
    logSpy.mockRestore();
    writeSpy.mockRestore();
    process.exitCode = savedExitCode;
  }
  return { out: plain(chunks.join('\n')), exitCode };
}

const CONFLICT_SENTENCE =
  '[metadata_conflict] view/race_probe has been modified since you loaded it. '
  + 'Expected parent sha256:aaa but current is sha256:bbb';

/** A client whose `fetch` answers with one canned response, body and status verbatim. */
function clientAnswering(status: number, body: unknown): ObjectStackClient {
  return new ObjectStackClient({
    baseUrl: 'https://door.test',
    token: 'test-token',
    fetch: async () => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'Conflict',
      json: async () => body,
      headers: new Headers(),
    }) as any,
  });
}

afterEach(() => {
  stub.client = undefined;
  stub.token = 'test-token';
  stub.createCalls = 0;
});

describe('[#13347] `os meta delete --format json` publishes the code it was handed', () => {
  it('POSITIVE CONTROL — the FLAT `@objectstack/rest` 409 arrives with `code` populated', async () => {
    // One frame earlier than the command: what the SDK's wrapper actually
    // builds. If this is empty the card's premise is dead, and no assertion
    // about the envelope below would be worth reading.
    const client = clientAnswering(409, { error: CONFLICT_SENTENCE, code: 'METADATA_CONFLICT' });
    const thrown = await client.meta
      .deleteItem('view', 'race_probe')
      .then(() => undefined, (e: any) => e);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.code).toBe('METADATA_CONFLICT');
    expect(thrown.httpStatus).toBe(409);
    expect(thrown.message).toBe(CONFLICT_SENTENCE);
  }, 60_000);

  it('the FLAT dialect reaches the envelope as `code` + `httpStatus` beside `error`', async () => {
    stub.client = clientAnswering(409, { error: CONFLICT_SENTENCE, code: 'METADATA_CONFLICT' });
    const run = await runCli(['view', 'race_probe', '--format', 'json']);

    expect(run.exitCode).toBe(1);
    const payload = JSON.parse(run.out);
    expect(payload).toEqual({
      success: false,
      error: CONFLICT_SENTENCE,
      code: 'METADATA_CONFLICT',
      httpStatus: 409,
    });
    // The whole point: the branch a script needs is readable WITHOUT
    // substring-matching the English sentence.
    expect(payload.code).toBe('METADATA_CONFLICT');
    // …and the payload is FLAT — option C was declined as breaking.
    expect(typeof payload.error).toBe('string');
  }, 60_000);

  it('the WRAPPED dispatcher dialect lands on the SAME spelling, not the numeric status', async () => {
    stub.client = clientAnswering(409, {
      success: false,
      error: { code: 'METADATA_CONFLICT', message: CONFLICT_SENTENCE, httpStatus: 409 },
    });
    const run = await runCli(['view', 'race_probe', '--format', 'json']);

    expect(run.exitCode).toBe(1);
    const payload = JSON.parse(run.out);
    expect(payload.code).toBe('METADATA_CONFLICT');
    expect(payload.httpStatus).toBe(409);
    // The regression #3842 fixed at the producer, pinned at this boundary: a
    // NUMBER under `code` would make the branch our docs teach never match.
    expect(typeof payload.code).toBe('string');
    expect(payload.code).not.toBe('409');
  }, 60_000);

  it('a status with no code publishes the status alone, not an invented code', async () => {
    stub.client = clientAnswering(503, { message: 'upstream unavailable' });
    const run = await runCli(['view', 'race_probe', '--format', 'json']);

    expect(run.exitCode).toBe(1);
    const payload = JSON.parse(run.out);
    expect(payload).toEqual({ success: false, error: 'upstream unavailable', httpStatus: 503 });
    expect(Object.keys(payload)).not.toContain('code');
  }, 60_000);

  it("OMIT ARM — the CLI's own local refusal emits NEITHER key, in the BYTES", async () => {
    // `metaDeleteOptions` throws a plain `Error` before a client exists.
    const run = await runCli(['view', 'race_probe', '--format', 'json', '--if-match', '']);

    expect(run.exitCode).toBe(1);
    // Genuinely local: nothing reached the network, so "no code" is not an
    // accident of a path that happened not to run.
    expect(stub.createCalls).toBe(0);

    const payload = JSON.parse(run.out);
    expect(payload).toEqual({ success: false, error: EMPTY_IF_MATCH_REFUSAL });
    // Asserted on the emitted TEXT, because `{ code: undefined }` would be
    // byte-identical through `JSON.stringify` at the object level.
    expect(run.out).not.toContain('"code"');
    expect(run.out).not.toContain('"httpStatus"');
    expect(Object.keys(payload).sort()).toEqual(['error', 'success']);
  }, 60_000);

  it('human `table` output is UNTOUCHED — same bytes, no carriers', async () => {
    // Explicitly out of scope for this card: the prose stays prose.
    stub.client = clientAnswering(409, { error: CONFLICT_SENTENCE, code: 'METADATA_CONFLICT' });
    const run = await runCli(['view', 'race_probe']);

    expect(run.exitCode).toBe(1);
    expect(run.out).toContain(CONFLICT_SENTENCE);
    expect(run.out).not.toContain('httpStatus');
    expect(run.out).not.toContain('METADATA_CONFLICT');
  }, 60_000);
});
