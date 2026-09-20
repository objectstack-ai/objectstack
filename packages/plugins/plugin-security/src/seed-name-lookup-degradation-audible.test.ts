// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18570] The batched existence read's OWN failure reaches the author even
 * when the caller injected no logger — the sixth instance of the
 * doubly-optional `logger?.warn?.(…)` shape, repaired through the ONE
 * derivation #18091 landed for it (`reportThroughSink`).
 *
 * ## Why every case here is DIFFERENTIAL, never a bare "did it print"
 *
 * The card that filed this site did not read it off the code — it drove an
 * unreadable-database pass twice and compared: with NO logger injected the run
 * produced exactly ONE author-visible line (an already-repaired #18091 site)
 * while this one stayed silent, and with a logger injected the same run
 * produced BOTH. A test that only asserts "an injected logger was called"
 * reproduces none of that: the old `logger?.warn?.(…)` passes it unchanged,
 * because the mute was never on the injected arm.
 *
 * So case 1 runs a **lit control on the same subject in the same run** —
 * `reportCapabilityRowsUnreadable`, an #18091 site that already reaches the
 * console with no sink. A zero from this site is a reading only while that
 * control fires; if the harness ever stops capturing `console.warn`, the
 * control goes to zero too and the case fails instead of passing vacuously.
 *
 * ## The three halves that must not move while the mute goes away
 *
 *  - **Case 2** — an injected sink still gets the line, with its receiver and
 *    its structured meta, and the console stays out of it. That is the half the
 *    pre-existing suites (`bootstrap-seed-round-trips`,
 *    `bootstrap-system-capabilities`, `permission-set-projection`) already pin
 *    from the seeder side; it is restated here because this file is what a
 *    later author edits.
 *  - **Case 3** — a read that ANSWERED is silent on every channel with no sink.
 *    This is the discriminating control #18023 established: routing a healthy
 *    boot's output to the console would turn every such control into noise.
 *    ⛔ Without this case, "always `console.warn`" would pass case 1.
 *  - **Case 4** — a host whose `warn` is not callable (a plain-JS embedder, or
 *    a cast) must not THROW, and must still reach the author. That is the third
 *    spelling `seed-refusal-sink.ts` refuses (`if (logger) logger.warn(…)`),
 *    and it is the reason this call site asks `typeof` rather than truthiness.
 */

import { describe, expect, it, vi } from 'vitest';

import { buildExistingByName } from './seed-name-lookup.js';
import { reportCapabilityRowsUnreadable } from './seed-refusal-diagnostics.js';

/** A driver seam that cannot answer at all — the outage arm. */
function unreadableQl() {
  return {
    find: async () => {
      throw new Error('database is unreachable');
    },
  };
}

/** A driver seam that answers, and answers "none of these names exist". */
function emptyPageQl() {
  const calls: unknown[][] = [];
  return {
    calls,
    find: async (...args: unknown[]) => {
      calls.push(args);
      return [] as any[];
    },
  };
}

/**
 * A driver seam whose page is a PREFIX of the answer — `readNamePage` asks for
 * `budget + 1` rows, so handing back that many is what truncation looks like.
 * Unscoped, a one-name read budgets `UNSCOPED_PAGE_FLOOR` (20) rows.
 */
function truncatedPageQl() {
  return {
    find: async () => Array.from({ length: 21 }, (_, i) => ({ id: `row-${i}`, name: 'alpha' })),
  };
}

/** Collect `console.warn` for the duration of one run. */
async function captureConsoleWarn(run: () => Promise<void>): Promise<unknown[][]> {
  const seen: unknown[][] = [];
  const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    seen.push(args);
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return seen;
}

const BATCHED_READ_FAILED = 'batched seed existence read failed';
const BATCHED_READ_TRUNCATED = 'batched seed existence read TRUNCATED';

describe('[#18570] batched seed existence read — its own failure is audible with no logger', () => {
  it('reports on the console beside a LIT CONTROL in the same run (the differential the card was graded on)', async () => {
    const seen = await captureConsoleWarn(async () => {
      // The site under repair, driven exactly as the card drove it: an
      // unreadable database and NO logger argument at all.
      await buildExistingByName(unreadableQl() as any, 'sys_capability', ['alpha', 'beta']);

      // THE LIT CONTROL, same run, same subject (author-visible output with no
      // sink injected): an #18091 site that already reaches the console.
      reportCapabilityRowsUnreadable(undefined, { unreadable: 2, total: 2 });
    });

    const lines = seen.map((args) => String(args[0]));

    // The control fires — so a zero from the site under repair would be a
    // reading rather than a dead harness.
    expect(lines.filter((l) => l.includes('capability_rows_unreadable'))).toHaveLength(1);

    // And the site under repair is no longer the silent one. Pre-#18570 this
    // run produced the control line ALONE.
    expect(lines.filter((l) => l.includes(BATCHED_READ_FAILED))).toHaveLength(1);
    expect(lines).toHaveLength(2);

    // The structured half travels with it — the console arm is the same report,
    // not a degraded restatement of it.
    const meta = seen.find((args) => String(args[0]).includes(BATCHED_READ_FAILED))?.[1] as Record<
      string,
      unknown
    >;
    expect(meta).toMatchObject({ object: 'sys_capability', names: 2 });
  });

  it('reports the TRUNCATED cause the same way, budget and all', async () => {
    const seen = await captureConsoleWarn(async () => {
      await buildExistingByName(truncatedPageQl() as any, 'sys_capability', ['alpha']);
    });

    expect(seen).toHaveLength(1);
    expect(String(seen[0]?.[0])).toContain(BATCHED_READ_TRUNCATED);
    expect(seen[0]?.[1]).toMatchObject({ object: 'sys_capability', names: 1, rowBudget: 20 });
  });

  it('still hands the line to an injected sink — with its receiver — and leaves the console alone', async () => {
    const received: Array<{ self: unknown; message: string; meta: unknown }> = [];
    // A CLASS-based sink, because the hazard `seed-refusal-sink.ts` records is a
    // delivery form that drops the receiver: `(logger?.warn ?? console.warn)(…)`
    // calls a bare function and a host reaching for `this` throws.
    class HostSink {
      readonly tag = 'host';
      warn(message: string, meta?: Record<string, any>) {
        received.push({ self: this, message, meta });
      }
    }
    const sink = new HostSink();

    const seen = await captureConsoleWarn(async () => {
      await buildExistingByName(unreadableQl() as any, 'sys_permission_set', ['alpha'], sink, 'org_1');
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.self).toBe(sink);
    expect(received[0]?.message).toContain(BATCHED_READ_FAILED);
    expect(received[0]?.meta).toMatchObject({
      object: 'sys_permission_set',
      names: 1,
      organization: 'org_1',
    });

    // ⛔ Not both channels: an injected host owns the report.
    expect(seen).toHaveLength(0);
  });

  it('stays silent on every channel when the read ANSWERED — the discriminating control', async () => {
    const ql = emptyPageQl();
    let verdict: string | undefined;

    const seen = await captureConsoleWarn(async () => {
      const index = await buildExistingByName(ql as any, 'sys_capability', ['alpha']);
      verdict = (await index.get('alpha')).status;
    });

    // The read really happened and really answered — `absent` is a fact here,
    // never a swallowed failure.
    expect(ql.calls).toHaveLength(1);
    expect(verdict).toBe('absent');

    // ⛔ A healthy pass buys no console noise. This is what keeps case 1 from
    // being satisfiable by an unconditional `console.warn`.
    expect(seen).toHaveLength(0);
  });

  it('reaches the author — without throwing — for a host whose `warn` is not callable', async () => {
    // The shape a plain-JS embedder or a cast produces, and the one
    // `if (logger) logger.warn(…)` turns into `logger.warn is not a function`
    // inside a degradation path.
    const lyingHost = { warn: 'not a function' } as unknown as { warn: (m: string) => void };

    const seen = await captureConsoleWarn(async () => {
      await buildExistingByName(unreadableQl() as any, 'sys_capability', ['alpha'], lyingHost as any);
    });

    expect(seen).toHaveLength(1);
    expect(String(seen[0]?.[0])).toContain(BATCHED_READ_FAILED);
  });
});
