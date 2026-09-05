// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Keep this process's stderr writes off the BLOCKING path for the whole run.
 *
 * Installed by BOTH CLI entry points — `bin/run.js` (the published `bin`
 * target) and `bin/run-dev.js` (the source shim) — immediately before `run()`.
 *
 * ## Why this module lives in `src/` and not beside the shims in `bin/`
 *
 * It was written in `bin/`, next to its only caller at the time. That put it
 * outside everything npm ships: `files` names `dist`, `README.md` and
 * `CHANGELOG.md`, and npm packs a `bin` TARGET regardless of `files` — which is
 * why `bin/run.js` reaches a published install and a sibling module beside it
 * does not. `npm pack --dry-run` listed `bin/run.js` as the only packed file
 * under `bin/`, so NO published install carried the guard at all while the
 * defect it prevents was reproducing on the shipped binary. Compiling from
 * `src/` puts it under the existing whitelist instead of widening it.
 *
 * ## The premise, and the measurement that made it false
 *
 * Node makes the premise true when it opens the pipe: `uv_pipe_open()` sets
 * `O_NONBLOCK` on fd 2 the moment `process.stderr` is first touched, so a write
 * to a reader that has stopped is BUFFERED rather than parking the thread
 * inside `write(2)`. What is easy to miss is that libuv CLEARS it again in the
 * pre-exec of every child spawned with inherited stdio
 * (`uv__process_child_init` does exactly that for fds 0-2, deliberately,
 * because a child expects blocking stdio) — and since inheriting is `dup2`, the
 * child shares the parent's OPEN FILE DESCRIPTION. The flag lives on the
 * description, not on the fd number, so clearing it for the child clears it for
 * the SPAWNER TOO.
 *
 * Measured on the PUBLISHED binary, `node bin/run.js dev --verbose` with its
 * output piped to a reader that stopped draining, sampling `/proc/PID/fdinfo/2`
 * from outside the process every 50 ms:
 *
 * ```
 *   112 ms  fd2 O_NONBLOCK=true    process.stderr materialised
 *  2829 ms  fd2 O_NONBLOCK=false   `os dev` spawns `os serve --dev`, stdio inherit
 *  2930 ms  fd2 O_NONBLOCK=true    the serve child materialised ITS OWN stdio
 *  5244 ms  fd2 O_NONBLOCK=false   the esbuild service, a GRANDCHILD, inherits stderr
 * ```
 *
 * and from there the main thread of the `os serve --dev` child never left
 * `write(2)`, 4 of 4 runs, 3.1 s after the reader stopped:
 *
 * ```
 * syscall=1(write) fd=2 O_NONBLOCK=false state=S wchan=sock_alloc_send_pskb
 *     tid=… (node) syscall=1(write)      ← the MAIN thread
 * ```
 *
 * Parked 28.9 s; SIGINT was IGNORED while parked (3 of 3, alive and still in
 * `write` five seconds later); released only when the reader resumed. With the
 * loop parked in the kernel there is no late timer to catch up and no signal
 * handler to run: the process is alive, idle, unresponsive, with an empty log.
 *
 * ## Why the re-assert is on the WRITE path and not done once at startup
 *
 * Because the clearing that PERSISTS is not made by this process. On the
 * published path it came from esbuild — spawned by the `os serve --dev` child,
 * two levels below the `os dev` parent, with only stderr inherited — 5.2 s into
 * the run, and no change to any of this CLI's own spawn sites would have
 * prevented it. The same holds under `tsx`, where the service is spawned when a
 * module has to be transformed (measured 27 of 30 on a cold transform cache
 * against 1 of 90 on a warm one). A one-shot at startup is undone by the next
 * such spawn — including from a module-hooks worker thread, which shares the
 * same descriptions — and it fails SILENTLY, back into the hang it was meant to
 * prevent. Re-asserting immediately before each write costs one `fcntl` and
 * cannot be outrun by a later spawn, whoever makes it.
 *
 * ⚠️ The reverse also happens and must not be mistaken for a fix: any Node
 * child that materialises its own stdio re-SETS the flag on the shared
 * description ~100 ms later. That is why fd 1 tends to escape and fd 2 does
 * not, and why "it was true the last time I looked" is worth nothing here.
 *
 * ## ⛔ This is not the prohibited call, it is its inverse
 *
 * `bin/run-dev.js` and `src/utils/format.ts` both refuse
 * `_handle.setBlocking(TRUE)`, and that refusal stands: forcing blocking writes
 * process-wide is what stalls `os serve` / `os dev` on its own logs. This
 * function forces the other direction — it is the thing that KEEPS those two
 * docblocks true when something else has quietly flipped the flag.
 *
 * ⛔ It does not touch a TTY. A terminal is written synchronously on POSIX by
 * design, has no unread-reader failure mode (the reader is a human's terminal),
 * and prompt-adjacent output would change behaviour for no benefit.
 */

/** Marks the stream so a second install cannot stack wrappers. */
const INSTALLED = Symbol.for('objectstack.stderr-nonblocking');

/**
 * The libuv handle behind a stdio stream. Not in `@types/node` — it is an
 * internal — so the shape this module actually uses is named here rather than
 * reached for through `any`.
 */
interface BlockingCapableHandle {
  setBlocking(blocking: boolean): void;
}

/** `stream.write`, seen as the plain callable this module re-invokes. */
type StreamWrite = (...args: unknown[]) => boolean;

/**
 * @param stream The stream to guard; defaults to `process.stderr`.
 *   Parameterised for the pin, which drives the guard against a manufactured
 *   blocking pipe rather than waiting for a cold cache.
 * @returns `true` when this process's writes are now guarded, `false` when
 *   there was nothing to guard (a TTY, a file, a stream with no libuv handle).
 *   The boolean is returned rather than logged: a reporter that announces
 *   itself on the very stream it is repairing is the one thing this file must
 *   not do.
 */
export function keepStderrNonBlocking(stream: NodeJS.WriteStream = process.stderr): boolean {
  if (!stream || stream.isTTY === true) return false;
  const handle = (stream as unknown as { _handle?: BlockingCapableHandle | null })._handle;
  if (!handle || typeof handle.setBlocking !== 'function') return false;

  const marks = stream as unknown as Record<symbol, boolean | undefined>;
  if (marks[INSTALLED]) return true;

  const target = stream as unknown as { write: StreamWrite };
  const write = target.write;
  if (typeof write !== 'function') return false;

  marks[INSTALLED] = true;
  target.write = function guardedWrite(this: unknown, ...args: unknown[]): boolean {
    // One `fcntl`, immediately ahead of the syscall that would otherwise park
    // this thread. Wrapped because a stream that lost its handle mid-run must
    // still take the write — a repair that throws is worse than the defect.
    try {
      handle.setBlocking(false);
    } catch {
      // Nothing to say and nowhere safe to say it.
    }
    return write.apply(this, args);
  };
  return true;
}
