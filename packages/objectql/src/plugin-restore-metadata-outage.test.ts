// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5897, ADR-0110 D3 — boot side] `restoreMetadataFromDb` must report an
 * unreadable `sys_metadata` as an outage, not as an empty store.
 *
 * ---------------------------------------------------------------------------
 * The defect
 * ---------------------------------------------------------------------------
 * `loadMetaFromDb` answered an unreachable database and a genuinely empty one
 * with the same `{ loaded: 0, errors: 0, invalid: 0 }`, so this method — its
 * ONLY production consumer — had nothing to branch on. Its single branch chose
 * between two log lines, and the "nothing came back" side of it was
 * `logger.debug('No persisted metadata found in database')`. A kernel that
 * could not read a word of its persisted metadata therefore said, at debug
 * level, that there was none, and went on to report ready.
 *
 * What that costs downstream is written into the plugin's own Phase 2 comment
 * and is not hypothetical: `registry.getObject` answers empty, so unknown-column
 * query guards, hooks and relationships silently degrade; overlay objects get
 * neither a synced table nor a metadata bridge. Every one of those reads
 * "the author declared nothing" where the truth is "we could not look".
 *
 * ---------------------------------------------------------------------------
 * What is pinned here
 * ---------------------------------------------------------------------------
 * The consumer half only — that the diagnostic bit is READ, and that the level
 * it is read at is `error` per AGENTS.md "Degradation log levels": persisted
 * state and runtime state disagree while the system keeps looking healthy.
 * The producer half (which failures set the bit, and that an un-provisioned
 * store does not) is pinned next to the classification it belongs to, in
 * `@objectstack/metadata-protocol`'s `protocol.load-meta-hydration-benign.test.ts`.
 *
 * The protocol double here declares `loadMetaFromDb` only — that is the entire
 * surface {@link hasLoadMetaFromDb} probes and the entire surface this method
 * calls. It declares no engine write verb, so there is no `delete`/`update`
 * dispatch for `check:engine-double-contract` to scan and nothing to
 * hand-mirror.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary direction, no inversion: stop propagating the bit — delete
 * `storeUnavailable = true` in the producer, or drop it from the destructure
 * here — and the outage case goes RED, because the log falls back to the
 * `debug` line it used to emit, which is the defect restated. The empty-store
 * and restored cases stay GREEN throughout: they never depended on the bit.
 * (Confirmed by running it, not assumed.)
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

type AnyRecord = Record<string, any>;

/** Captures one call to each level so a test can assert WHICH level fired. */
function makeCtx(protocol: unknown) {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    logger,
    getService: vi.fn((name: string) => {
      if (name === 'protocol') return protocol;
      throw new Error(`service '${name}' not registered`);
    }),
    hook: vi.fn(),
  } as AnyRecord;
}

/**
 * A protocol double whose `loadMetaFromDb` answers `result` verbatim.
 *
 * Deliberately NOT the real `ObjectStackProtocolImplementation`: this file is
 * about how the consumer reads the return CONTRACT, so the contract is what it
 * feeds in. Which real failures produce which return is the producer's test.
 */
function protocolReturning(result: AnyRecord) {
  return { loadMetaFromDb: vi.fn(async () => result) };
}

/** The engine is untouched by this path; a bare object satisfies the ctor. */
function makePlugin() {
  return new ObjectQLPlugin({ ql: {} as unknown as ObjectQL });
}

/** Every string the logger was handed at `level`, joined for keyword checks. */
function linesAt(ctx: AnyRecord, level: 'debug' | 'info' | 'warn' | 'error'): string[] {
  return ctx.logger[level].mock.calls.map((c: unknown[]) => String(c[0]));
}

describe('ObjectQLPlugin.restoreMetadataFromDb — an unreadable store is an outage (#5897)', () => {
  it('logs at ERROR, not debug, when the protocol reports storeUnavailable', async () => {
    const ctx = makeCtx(
      protocolReturning({ loaded: 0, errors: 0, invalid: 0, storeUnavailable: true }),
    );

    await (makePlugin() as any).restoreMetadataFromDb(ctx);

    const errors = linesAt(ctx, 'error');
    expect(errors).toHaveLength(1);

    // Pre-fix, THIS is what an unreachable database produced — the assertion
    // that fails first if the branch is ever removed.
    expect(linesAt(ctx, 'debug')).not.toContain('No persisted metadata found in database');
    expect(linesAt(ctx, 'debug').join('\n')).not.toMatch(/No persisted metadata/);
  });

  it("the error line owes both things AGENTS.md requires: the consequence and the fix", async () => {
    const ctx = makeCtx(
      protocolReturning({ loaded: 0, errors: 0, invalid: 0, storeUnavailable: true }),
    );

    await (makePlugin() as any).restoreMetadataFromDb(ctx);

    const line = linesAt(ctx, 'error')[0];
    // Names WHAT could not be read…
    expect(line).toContain('sys_metadata');
    // …that it was not restored, and that the kernel will still look healthy —
    // the half operators cannot infer and the reason this is `error` at all.
    expect(line).toMatch(/NOT restored/);
    expect(line).toMatch(/healthy/);
    // …and the remedy, concretely enough to act on without reading the source.
    expect(line).toMatch(/connection|credentials|datasource/);
    // …plus the boundary, so the line is not read as covering first boots.
    expect(line).toMatch(/provisioned/);
  });

  it('carries the counts as structured metadata rather than burying them in prose', async () => {
    const ctx = makeCtx(
      protocolReturning({ loaded: 0, errors: 0, invalid: 0, storeUnavailable: true }),
    );

    await (makePlugin() as any).restoreMetadataFromDb(ctx);

    // The `Logger` contract is `error(message, error?: Error, meta?)`, so the
    // counts ride the THIRD slot and the error slot stays empty — there is no
    // Error to pass: `loadMetaFromDb` swallowed the driver's, having already
    // printed it at `warn`. Pinned positionally because the two-argument
    // spelling type-checks against `ObjectLogger` (which tolerates meta in the
    // error slot) while violating the declared contract every other Logger
    // implementation is written to.
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      { loaded: 0, errors: 0, invalid: 0 },
    );
  });

  it('outranks the counts: a partial hydration that ALSO lost the store still reports the outage', async () => {
    // Defensive on purpose. Today the outer read either throws before any row
    // is seen or does not throw at all, so `loaded > 0 && storeUnavailable` is
    // not reachable — but the branch ORDER is the thing being pinned, and the
    // wrong order (counts first) would degrade silently the day it becomes
    // reachable, which is precisely this issue's failure mode one layer up.
    const ctx = makeCtx(
      protocolReturning({ loaded: 3, errors: 1, invalid: 0, storeUnavailable: true }),
    );

    await (makePlugin() as any).restoreMetadataFromDb(ctx);

    expect(linesAt(ctx, 'error')).toHaveLength(1);
    expect(linesAt(ctx, 'info')).toEqual([]);
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      { loaded: 3, errors: 1, invalid: 0 },
    );
  });
});

describe('ObjectQLPlugin.restoreMetadataFromDb — health is still reported as health (#5897)', () => {
  it('an empty but READABLE store keeps the quiet debug line', async () => {
    // The over-application guard. Escalating this to `error` is the
    // mirror-image failure AGENTS.md names: every first boot in every test and
    // every fresh install would print a durability error, and `error` stops
    // being readable — which is what made the original `warn` unreadable.
    const ctx = makeCtx(
      protocolReturning({ loaded: 0, errors: 0, invalid: 0, storeUnavailable: false }),
    );

    await (makePlugin() as any).restoreMetadataFromDb(ctx);

    expect(linesAt(ctx, 'error')).toEqual([]);
    expect(linesAt(ctx, 'debug')).toContain('No persisted metadata found in database');
  });

  it('a successful restore still reports info with loaded/errors/invalid', async () => {
    const ctx = makeCtx(
      protocolReturning({ loaded: 4, errors: 1, invalid: 2, storeUnavailable: false }),
    );

    await (makePlugin() as any).restoreMetadataFromDb(ctx);

    expect(linesAt(ctx, 'error')).toEqual([]);
    expect(ctx.logger.info).toHaveBeenCalledWith(
      'Metadata restored from database to SchemaRegistry',
      { loaded: 4, errors: 1, invalid: 2 },
    );
  });

  it('a protocol shim that predates the field is read as "not an outage", not as undefined', async () => {
    // `storeUnavailable` is OPTIONAL on `ProtocolWithDbRestore` because the
    // interface is structural — matched against whatever object is registered
    // as `protocol`. An older shim omitting it must behave exactly as it did
    // before this change, which is the whole basis for calling the field
    // non-breaking in the changeset.
    const ctx = makeCtx(protocolReturning({ loaded: 0, errors: 0 }));

    await (makePlugin() as any).restoreMetadataFromDb(ctx);

    expect(linesAt(ctx, 'error')).toEqual([]);
    expect(linesAt(ctx, 'debug')).toContain('No persisted metadata found in database');
  });
});

describe('ObjectQLPlugin.restoreMetadataFromDb — the pre-existing skip paths are untouched (#5897)', () => {
  it('a protocol without loadMetaFromDb still skips at debug', async () => {
    const ctx = makeCtx({ notTheRightShape: true });

    await (makePlugin() as any).restoreMetadataFromDb(ctx);

    expect(linesAt(ctx, 'error')).toEqual([]);
    expect(linesAt(ctx, 'debug').join('\n')).toMatch(/does not support loadMetaFromDb/);
  });

  it('no protocol service at all still skips at debug', async () => {
    const ctx = makeCtx(undefined);
    ctx.getService = vi.fn(() => {
      throw new Error('service not registered');
    });

    await (makePlugin() as any).restoreMetadataFromDb(ctx);

    expect(linesAt(ctx, 'error')).toEqual([]);
    expect(linesAt(ctx, 'debug').join('\n')).toMatch(/Protocol service unavailable/);
  });
});
