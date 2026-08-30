// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13347] `errorCodeFields` — the ADR-0112 carriers a `--format json` failure
 * envelope adds beside its `error` sentence, and the arm that adds NOTHING.
 *
 * ## What is being pinned, and why it is pinned on BYTES
 *
 * Ruled 2026-08-30 (option **A**): when the thrown error carries `code` /
 * `httpStatus`, emit them alongside `error`; when it does not, OMIT them.
 * `success` and `error` keep their meaning and spelling, so the change is
 * additive and no existing consumer breaks. The payload stays FLAT — option C
 * (nesting into `{ error: { code, message, httpStatus } }`) was declined as
 * breaking — and no fallback code is invented for a locally-thrown plain
 * `Error` (option B, not chosen).
 *
 * The omit arm is the half that ships broken silently, because the WRONG
 * implementation of it — `{ ...payload, code: error.code }`, leaving
 * `code: undefined` on the object — is byte-identical to the right one through
 * `JSON.stringify`, and byte-identical through `yaml.stringify` as well (both
 * measured below). It stops being identical on `formatOutput`'s `table`
 * branch, which walks `Object.entries` and prints `code: null` for a
 * present-but-undefined key. So every omission case here asserts the emitted
 * TEXT, and one case asserts the wrong implementation is visibly different —
 * a negative control, without which "the bytes have no `code`" would pass
 * against an implementation that leaks the key.
 */

import { describe, it, expect, vi } from 'vitest';
import yaml from 'yaml';

import { errorCodeFields, emitJson, isExitSignal } from './format.js';
import { formatOutput } from './output-formatter.js';

/** Capture everything a payload emitter writes, `console.log` and stdout alike. */
async function captureEmit(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const logSpy = vi
    .spyOn(console, 'log')
    .mockImplementation((...args: unknown[]) => { chunks.push(args.map(String).join(' ')); });
  // `emitText` writes through `writeStdoutDirect`, which calls
  // `stdout.write(text, callback)` and AWAITS the callback. A stub that
  // swallows the callback does not fail, it HANGS — invoke it.
  const writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((chunk: unknown, encodingOrCb?: unknown, maybeCb?: unknown) => {
      chunks.push(String(chunk));
      const done = typeof encodingOrCb === 'function' ? encodingOrCb : maybeCb;
      if (typeof done === 'function') (done as (err?: Error | null) => void)(null);
      return true;
    }) as never);
  const savedExitCode = process.exitCode;
  try {
    await run();
  } finally {
    logSpy.mockRestore();
    writeSpy.mockRestore();
    process.exitCode = savedExitCode;
  }
  return chunks.join('\n');
}

/**
 * An error shaped the way `@objectstack/client`'s `fetch` wrapper shapes one:
 * a real `Error` with the ADR-0112 string on `code` and the numeric status on
 * `httpStatus`. The end-to-end proof that the SDK really produces this — from
 * a real 409 body, through the real wrapper, into a real command's `catch` —
 * lives in `commands/meta/delete-json-error-code.test.ts`; this file pins what
 * the builder does with it.
 */
function sdkError(message: string, code: string | undefined, httpStatus: number): Error {
  const e = new Error(message) as Error & { code?: string; httpStatus?: number };
  if (code !== undefined) e.code = code;
  e.httpStatus = httpStatus;
  return e;
}

describe('[#13347] errorCodeFields — what counts as "carrying" a code', () => {
  it('adds BOTH carriers when the error carries both (the SDK shape)', () => {
    const err = sdkError('[metadata_conflict] view/race_probe has been modified', 'METADATA_CONFLICT', 409);
    expect(errorCodeFields(err)).toEqual({ code: 'METADATA_CONFLICT', httpStatus: 409 });
  });

  it('adds NEITHER for a locally-thrown plain Error — no fallback is invented', () => {
    // Option B was NOT chosen: the CLI's own input refusals get no code, and
    // ADR-0112's ledger stays the authority on who may mint one.
    expect(errorCodeFields(new Error('--if-match needs the metadata version'))).toEqual({});
  });

  it('decides the two keys INDEPENDENTLY — a status with no code still ships', () => {
    // Not a style choice: the SDK sets `error.httpStatus = res.status` on EVERY
    // non-2xx, while `error.code` is `undefined` whenever the server sent none.
    // "Emit both or neither" would discard a status that is in hand, on exactly
    // the responses whose envelope is thinnest.
    expect(errorCodeFields(sdkError('Bad Request', undefined, 400))).toEqual({ httpStatus: 400 });
    // …and the mirror: a code with no status.
    const coded = new Error('boom') as Error & { code?: string };
    coded.code = 'VALIDATION_FAILED';
    expect(errorCodeFields(coded)).toEqual({ code: 'VALIDATION_FAILED' });
  });

  it('REJECTS a numeric `code` rather than coercing it', () => {
    // The pre-#3842 wrapped envelope parked the HTTP STATUS in `error.code`.
    // Re-publishing a number under the name the semantic vocabulary uses would
    // reintroduce that confusion at this boundary; `httpStatus` still ships.
    const legacy = new Error('boom') as Error & { code?: unknown; httpStatus?: number };
    legacy.code = 400;
    legacy.httpStatus = 400;
    expect(errorCodeFields(legacy)).toEqual({ httpStatus: 400 });
  });

  it('rejects an empty-string code and a non-integer status', () => {
    const blank = new Error('boom') as Error & { code?: string; httpStatus?: number };
    blank.code = '';
    blank.httpStatus = Number.NaN;
    expect(errorCodeFields(blank)).toEqual({});
    const fractional = new Error('boom') as Error & { httpStatus?: number };
    fractional.httpStatus = 409.5;
    expect(errorCodeFields(fractional)).toEqual({});
  });

  it("never publishes oclif's EEXIT control signal as an error code", () => {
    // `this.exit(n)` THROWS an ExitError whose `code` is the string 'EEXIT',
    // and several of the 48 catch blocks do not re-throw it first (`os migrate
    // meta` carries a comment about the bare "EEXIT: 1" it would report). It is
    // our own stack unwinding, not a vocabulary a consumer may branch on.
    const exitError = new Error('EEXIT: 1') as Error & { code?: string; oclif?: { exit: number } };
    exitError.code = 'EEXIT';
    exitError.oclif = { exit: 1 };
    expect(isExitSignal(exitError)).toBe(true);
    expect(errorCodeFields(exitError)).toEqual({});

    // The other spelling of the same signal — `oclif.exit` with no `code`.
    const bare = new Error('exit') as Error & { oclif?: { exit: number } };
    bare.oclif = { exit: 2 };
    expect(errorCodeFields(bare)).toEqual({});
  });

  it('survives a non-object throw without inventing anything', () => {
    // `throw 'a string'` and `throw null` both reach these catch blocks as
    // `error`, and a builder that indexed them blindly would take the command
    // down on the failure path.
    for (const thrown of [undefined, null, 'a string', 42, { nope: true }]) {
      expect(errorCodeFields(thrown)).toEqual({});
    }
  });

  it('returns a FRESH object each call — the spread must not alias shared state', () => {
    const a = errorCodeFields(sdkError('x', 'A_CODE', 400));
    const b = errorCodeFields(new Error('plain'));
    expect(a).not.toBe(b);
    expect(errorCodeFields(new Error('plain'))).toEqual({});
  });
});

describe('[#13347] the emitted BYTES — additive when present, absent when not', () => {
  it('emitJson: the carriers appear beside `error`, and `success`/`error` keep their spelling', async () => {
    const err = sdkError('[metadata_conflict] view/json_probe has been modified', 'METADATA_CONFLICT', 409);
    const out = await captureEmit(() =>
      emitJson({ success: false, error: err.message, ...errorCodeFields(err) }),
    );
    const payload = JSON.parse(out);
    expect(payload).toEqual({
      success: false,
      error: '[metadata_conflict] view/json_probe has been modified',
      code: 'METADATA_CONFLICT',
      httpStatus: 409,
    });
    // FLAT, not nested — option C was declined as breaking.
    expect(typeof payload.error).toBe('string');
    // The two keys existing consumers read are untouched, by name and by value.
    expect(Object.keys(payload).slice(0, 2)).toEqual(['success', 'error']);
  });

  it('emitJson: a plain Error emits the SAME BYTES it emitted before this card', async () => {
    const err = new Error('--if-match needs the metadata version to pin the reset to');
    const before = await captureEmit(() => emitJson({ success: false, error: err.message }));
    const after = await captureEmit(() =>
      emitJson({ success: false, error: err.message, ...errorCodeFields(err) }),
    );
    expect(after).toBe(before);
    expect(after).not.toContain('code');
    expect(after).not.toContain('httpStatus');
  });

  it('NEGATIVE CONTROL: `code: undefined` is what this must NOT build', async () => {
    // Without this case, the assertion above passes against the WRONG
    // implementation on two of the three emitters. Here is the measurement of
    // where each one hides it and where it does not.
    const leaky = { success: false, error: 'boom', code: undefined as string | undefined };
    const clean = { success: false, error: 'boom' };

    // JSON: identical — the trap.
    expect(JSON.stringify(leaky)).toBe(JSON.stringify(clean));
    // YAML: also identical — `yaml.stringify` drops undefined too.
    expect(yaml.stringify(leaky)).toBe(yaml.stringify(clean));
    // The object itself is NOT identical, and that is what leaks one emitter over.
    expect(Object.keys(leaky)).toEqual(['success', 'error', 'code']);
    expect(Object.keys(clean)).toEqual(['success', 'error']);

    // `formatOutput`'s human branch is where the difference becomes visible.
    const leakyTable = await captureEmit(() => formatOutput(leaky, 'table'));
    const cleanTable = await captureEmit(() => formatOutput(clean, 'table'));
    expect(leakyTable).toContain('code');
    expect(cleanTable).not.toContain('code');

    // What the builder actually returns has no such key to leak.
    expect(Object.keys({ ...clean, ...errorCodeFields(new Error('boom')) })).toEqual(['success', 'error']);
  });

  it('formatOutput yaml/table: the omit arm adds no key on any emitter', async () => {
    const payload = { success: false, error: 'boom', ...errorCodeFields(new Error('boom')) };
    const asYaml = await captureEmit(() => formatOutput(payload, 'yaml'));
    expect(asYaml).not.toContain('code');
    expect(asYaml).not.toContain('httpStatus');
    const asTable = await captureEmit(() => formatOutput(payload, 'table'));
    expect(asTable).not.toContain('code');
    expect(asTable).not.toContain('httpStatus');
  });

  it('the compact NDJSON writers stay one line with the carriers added', async () => {
    // `os login` / `os cloud login` declare NDJSON: one record per line is the
    // contract, and a payload that wrapped would break every consumer reading
    // stdout a line at a time.
    const err = sdkError('device code expired', 'EXPIRED_TOKEN', 401);
    const out = await captureEmit(() =>
      emitJson({ success: false, error: err.message, ...errorCodeFields(err) }, 0, { compact: true }),
    );
    expect(out.trimEnd().split('\n')).toHaveLength(1);
    expect(JSON.parse(out)).toEqual({
      success: false,
      error: 'device code expired',
      code: 'EXPIRED_TOKEN',
      httpStatus: 401,
    });
  });
});
