// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15653 — the pin the attribution idiom never had.
 *
 * Four e2e files here boot a real `os serve` and `fetch` it. When that request
 * fails the useful question is always the same: did the CHILD die, or did a
 * live child drop the connection? Every one of those files used to answer
 * neither, because `child.on('exit')` fed the READINESS promise only — so a
 * death after readiness was invisible and the rejection reached vitest as a
 * bare `TypeError: fetch failed`, with no exit code, no stdout and no stderr.
 * One such occurrence was recorded in a merge-group run and could not be
 * attributed at all.
 *
 * `probeThroughChild()` in `helpers/serve-process.ts` is the repair. This file
 * is what makes it a MEASUREMENT rather than a claim, and it exists because the
 * repair landed once already (on the NODE_ENV file) proven only by an ad-hoc
 * harness that was never committed — so nothing in the tree could fail if the
 * attribution stopped working.
 *
 * ## Why the failure here is DRIVEN, not mocked
 *
 * ⭐ An assertion that "the error message contains the exit code" is vacuous if
 * the child never dies. So every case below spawns a REAL child process and
 * makes a REAL `fetch` against it fail on the wire. The child is not `os serve`
 * — it is a ~30-line TCP peer that reproduces the one client-side signature
 * that matters, `UND_ERR_SOCKET` / "other side closed" / `bytesRead: 0`, by
 * accepting the whole request and then FINning without answering. That is the
 * cheaper deterministic driver: `os serve` cannot be asked to die mid-request on
 * command, needs a built `dist/`, and costs ~20 s a boot, while this peer
 * produces a byte-identical client-side rejection in milliseconds and can be
 * told to exit with a chosen code, or to stay up, on demand.
 *
 * ⛔ What that swap does NOT cover is the product: this file is a pin on the
 * HARNESS's attribution, not on `os serve`'s behaviour. The four e2e files
 * remain the ones that boot the real command.
 *
 * ## The controls, and the axis each one discriminates on
 *
 * `HEALTHY CONTROL` — a child that ANSWERS. It discriminates on **"did this
 * harness talk to a live peer at all"**: if the spawn were broken, the port
 * wrong, or the child never listening, every failing case above would still go
 * red for a reason that has nothing to do with attribution, and would read
 * exactly like a passing repair. It must come back `200`, and the guard must be
 * transparent — a control that only ever fails is not a control.
 *
 * `PROBES_EXERCISED` — a counter incremented INSIDE each request thunk, printed
 * and asserted non-zero at the end. It discriminates on **"did the guarded path
 * actually run"**: a `probeThroughChild()` that returned early, or a `rejects`
 * matcher against a promise that was never created, would leave it at zero.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import {
  CHILD_EXIT_SETTLE_MS,
  PROBE_ATTEMPTS,
  childEnv,
  fateOf,
  probeThroughChild,
  reservePort,
  settleChildFate,
  transportCode,
  transportSignature,
  type LifecycleChild,
} from './helpers/serve-process.js';

/**
 * The driver. Three modes, one shape:
 *
 *   `answer` — replies `200 {"ok":true}`. The healthy control.
 *   `die`    — accepts the whole request, FINs without answering, exits 7.
 *   `live`   — accepts and FINs every connection, forever. Never exits.
 *
 * ⛔ No `${...}` anywhere in here: this string is embedded in a template
 * literal, so a dollar-brace would be interpolated by THIS file rather than
 * reaching the child.
 */
const DRIVER = `
import { createServer } from 'node:net';

const mode = process.argv[2];
process.stdout.write('probe-child stdout: mode ' + mode + '\\n');
process.stderr.write('probe-child stderr: mode ' + mode + '\\n');

const server = createServer((socket) => {
  const chunks = [];
  socket.on('error', () => {});
  socket.on('data', (chunk) => {
    chunks.push(chunk);
    // Wait for the whole request head, so the client has finished writing and
    // the socket reports bytesWritten > 0 with bytesRead still 0.
    if (!Buffer.concat(chunks).toString('utf8').includes('\\r\\n\\r\\n')) return;
    if (mode === 'answer') {
      const body = '{"ok":true}';
      socket.end(
        'HTTP/1.1 200 OK\\r\\ncontent-type: application/json\\r\\n'
        + 'content-length: ' + body.length + '\\r\\nconnection: close\\r\\n\\r\\n' + body,
      );
      return;
    }
    process.stderr.write('probe-child stderr: FIN without answering\\n');
    socket.end();
    if (mode === 'die') {
      socket.on('close', () => {
        process.stderr.write('probe-child stderr: exiting 7\\n');
        process.exit(7);
      });
    }
  });
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write('LISTENING ' + server.address().port + '\\n');
});
`;

const dir = mkdtempSync(join(tmpdir(), 'probe-child-attribution-'));
const DRIVER_PATH = join(dir, 'driver.mjs');
writeFileSync(DRIVER_PATH, DRIVER, 'utf8');

/** What `spawn(…, { stdio: ['ignore', 'pipe', 'pipe'] })` returns — no `stdin`. */
type ProbeChild = ChildProcessByStdio<null, Readable, Readable>;

const children: ProbeChild[] = [];

/** Markers the child prints on both streams, so a transcript can be PROVEN carried. */
const STDOUT_MARKER = 'probe-child stdout:';
const STDERR_MARKER = 'probe-child stderr:';

interface Driven {
  child: ProbeChild;
  port: number;
  transcript: () => string;
}

/** Boot the driver and wait until it has said which port it bound. */
function drive(mode: 'answer' | 'die' | 'live'): Promise<Driven> {
  return new Promise((ready, fail) => {
    const child = spawn(process.execPath, [DRIVER_PATH, mode], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      // `childEnv()`, not an omitted `env` and not a bare `...process.env`. This
      // driver reads no variable of its own, so the declaration is not about what
      // it needs — it is the one `check:cli-test-child-env` requires of every
      // child spawned from this directory, and the honest answer here is "the
      // environment minus the vitest worker family".
      env: childEnv(),
    }) as ProbeChild;
    children.push(child);

    let out = '';
    let err = '';
    const transcript = () => `\n--- child stdout ---\n${out}\n--- child stderr ---\n${err}`;
    const timer = setTimeout(
      () => fail(new Error(`driver never announced a port${transcript()}`)),
      30_000,
    );

    child.stdout.on('data', (d) => {
      out += String(d);
      const match = /LISTENING (\d+)/.exec(out);
      if (!match) return;
      clearTimeout(timer);
      ready({ child, port: Number(match[1]), transcript });
    });
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`driver exited ${String(code)} before announcing a port${transcript()}`));
    });
  });
}

async function stop(child: ProbeChild): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const give = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      done();
    }, 5_000);
    child.once('exit', () => { clearTimeout(give); done(); });
    try { child.kill('SIGTERM'); } catch { clearTimeout(give); done(); }
  });
}

/** ⭐ Incremented INSIDE the thunk — see the header's control section. */
let probesExercised = 0;

/** The request every case sends — the same shape the origin probes send. */
function signInRequest(port: number): Promise<{ status: number; body: unknown }> {
  probesExercised += 1;
  return fetch(`http://127.0.0.1:${port}/api/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@example.com', password: 'definitely-wrong-password' }),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

afterAll(async () => {
  for (const child of children) await stop(child);
  rmSync(dir, { recursive: true, force: true });
}, 30_000);

describe('#15653: an HTTP probe against a spawned child names the child\'s fate', () => {
  it(
    'BEFORE — an UNGUARDED fetch against a child that dies mid-request says only `fetch failed`',
    async () => {
      const { child, port, transcript } = await drive('die');
      // ⛔ Deliberately NOT through `probeThroughChild()`. This is the shape the
      // four e2e files had, reproduced, so the repair below has a measured
      // before-state to be an improvement over rather than an assertion about one.
      const bare = await signInRequest(port).then(
        () => null,
        (err: unknown) => err as Error,
      );

      expect(bare, 'the driven failure did not happen — nothing was measured').toBeTruthy();
      expect(bare!.message).toBe('fetch failed');
      // The recorded merge-group signature, reproduced: the request was fully
      // delivered and the peer closed without answering.
      expect(transportCode(bare)).toBe('UND_ERR_SOCKET');
      expect(transportSignature(bare)).toContain('bytesRead=0');

      // ⭐ THE DEFECT, stated as an assertion: everything needed to attribute
      // this failure is absent from what vitest would have been shown.
      const shown = `${bare!.message}\n${bare!.stack ?? ''}`;
      expect(shown, 'the bare rejection must not name an exit code').not.toContain('exit code');
      expect(shown).not.toContain(STDOUT_MARKER);
      expect(shown).not.toContain(STDERR_MARKER);

      // ...and the child really is dead, so the information existed to be read.
      const fate = await settleChildFate(child, CHILD_EXIT_SETTLE_MS);
      expect(fate.exited).toBe(true);
      expect(fate.code).toBe(7);
      expect(transcript()).toContain('exiting 7');
    },
    60_000,
  );

  it(
    'AFTER — the SAME driven failure names the exit status and carries what the child printed',
    async () => {
      const { port, child, transcript } = await drive('die');
      const failure = await probeThroughChild(
        { child, transcript, label: 'probe-child-attribution', what: `the sign-in probe on port ${port}` },
        () => signInRequest(port),
      ).then(() => null, (err: unknown) => err as Error);

      expect(failure, 'the driven failure did not happen — nothing was measured').toBeTruthy();
      const message = failure!.message;

      // The two artefacts the bare rejection above discarded.
      expect(message, 'the exit code must be named').toContain('exit code 7');
      expect(message, 'the signal must be named').toContain('signal null');
      expect(message, "the child's stdout must be quoted").toContain(STDOUT_MARKER);
      expect(message, "the child's stderr must be quoted").toContain(STDERR_MARKER);
      expect(message, 'the crash the child printed on its way down must be quoted')
        .toContain('exiting 7');

      // The verdict itself, and the fence: a dead child is never retried.
      expect(message).toContain('os serve DIED');
      expect(message).toContain('NOT retried');
      expect(message).toContain('attempt 1/3');
      // The transport evidence survives the repair rather than being replaced by it.
      expect(message).toContain('UND_ERR_SOCKET');
      expect(message).toContain('bytesRead=0');
    },
    60_000,
  );

  it(
    'HEALTHY CONTROL — against a child that ANSWERS, the guard is transparent',
    async () => {
      // ⭐ The axis: "did this harness talk to a live peer at all". Every failing
      // case above would look identical if the spawn, the port or the request
      // were broken. This one can only pass if they work.
      const { child, port, transcript } = await drive('answer');
      const answer = await probeThroughChild(
        { child, transcript, label: 'probe-child-attribution', what: `the sign-in probe on port ${port}` },
        () => signInRequest(port),
      );
      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({ ok: true });
      // And the child is still alive: the guard neither killed nor waited on it.
      expect(fateOf(child).exited).toBe(false);
    },
    60_000,
  );

  it(
    'a transport failure that is NOT `UND_ERR_SOCKET` is rethrown at once, with the transcript',
    async () => {
      // A LIVE child, but the request is addressed to a port nothing listens on
      // — the bind-probed draw is free by construction, so this is ECONNREFUSED:
      // the shape a genuine readiness race has, and the one that must never be
      // absorbed as a dropped connection.
      const { child, transcript } = await drive('live');
      const closedPort = reservePort();
      const failure = await probeThroughChild(
        { child, transcript, label: 'probe-child-attribution', what: `the sign-in probe on port ${closedPort}` },
        () => signInRequest(closedPort),
      ).then(() => null, (err: unknown) => err as Error);

      expect(failure, 'the driven failure did not happen — nothing was measured').toBeTruthy();
      expect(failure!.message).toContain('does not absorb');
      expect(failure!.message).toContain('attempt 1/3');
      expect(failure!.message).toContain(STDERR_MARKER);
      // ⭐ The discriminating half: it failed on its FIRST attempt. An absorbed
      // one would have printed attempt 2 and 3 before giving up.
      expect(failure!.message).not.toContain('attempt 2/3');
      expect(fateOf(child).exited, 'the child must still be alive for this case to mean anything')
        .toBe(false);
    },
    60_000,
  );

  it(
    'a LIVE child that FINs every attempt is absorbed exactly PROBE_ATTEMPTS times, then blamed',
    async () => {
      const { child, port, transcript } = await drive('live');
      const before = probesExercised;
      const failure = await probeThroughChild(
        { child, transcript, label: 'probe-child-attribution', what: `the sign-in probe on port ${port}` },
        () => signInRequest(port),
      ).then(() => null, (err: unknown) => err as Error);

      expect(failure, 'the driven failure did not happen — nothing was measured').toBeTruthy();
      // ⭐ The bound is REAL: the request was actually re-sent, three times.
      expect(probesExercised - before).toBe(PROBE_ATTEMPTS);
      expect(failure!.message).toContain('never completed a request');
      expect(failure!.message).toContain('live server dropping connections, not a dead child');
      expect(failure!.message).toContain('attempt 3/3');
      // ⛔ Never silent: every absorbed attempt is in the message.
      expect(failure!.message).toContain('attempt 1/3');
      expect(failure!.message).toContain('attempt 2/3');
      expect(fateOf(child).exited).toBe(false);
    },
    60_000,
  );

  it('settleChildFate WAITS for `exit` instead of reading `exitCode` at rejection time', async () => {
    // The mechanism the driven cases rest on, pinned deterministically: the FIN
    // reaches the client on the network's schedule and `exit` arrives on the
    // event loop's, so a synchronous read reports a dead child as ALIVE. A fake
    // child is right HERE — the point is the timing of the two reads, and a real
    // process cannot be made to deliver `exit` at a chosen instant.
    let listener: (() => void) | undefined;
    const late: LifecycleChild = {
      exitCode: null,
      signalCode: null,
      once: (_event, fn) => { listener = fn; return late; },
      off: () => late,
    };

    // The synchronous read, taken at the instant a `fetch` would have rejected.
    expect(fateOf(late).exited, 'the sync read reports a not-yet-reaped child as alive').toBe(false);

    const settling = settleChildFate(late, CHILD_EXIT_SETTLE_MS);
    setTimeout(() => {
        late.exitCode = 7;
      listener?.();
    }, 50);

    expect(await settling).toEqual({ exited: true, code: 7, signal: null });
  });

  it('the guarded path really ran — a non-zero count of probes exercised', () => {
    // ⛔ Not decoration. Every assertion above lives behind a promise; if the
    // thunks had never been invoked, the `rejects`-style checks would still pass
    // against errors thrown for other reasons and this file would be green
    // having measured nothing.
    console.error(`[probe-child-attribution] probes exercised: ${probesExercised}`);
    expect(probesExercised).toBeGreaterThan(0);
    // 1 (bare) + 1 (attributed) + 1 (healthy) + 1 (not absorbed) + 3 (absorbed).
    expect(probesExercised).toBe(7);
  });
});
