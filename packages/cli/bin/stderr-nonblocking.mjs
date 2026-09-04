// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Keep this process's stderr writes off the BLOCKING path for the whole run.
 *
 * `bin/run-dev.js` bounds how long it waits for stderr to drain, and the bound
 * is enforced by a 50 ms `setInterval`. That instrument — and every other
 * timer, callback and promise in the process — only exists while the event loop
 * is running, so the bound is worth exactly as much as the premise underneath
 * it: that a write to a pipe nobody is reading gets BUFFERED rather than
 * parking the thread inside `write(2)`.
 *
 * ## The premise is not free, and it was measured false
 *
 * Node makes that premise true when it opens the pipe: `uv_pipe_open()` sets
 * `O_NONBLOCK` on fd 2 the moment `process.stderr` is first touched. What is
 * easy to miss is that libuv CLEARS it again in the pre-exec of every child
 * spawned with inherited stdio (`uv__process_child_init` does exactly that for
 * fds 0-2, deliberately, because a child expects blocking stdio) — and since
 * inheriting is `dup2`, the child shares the parent's OPEN FILE DESCRIPTION.
 * The flag lives on the description, not on the fd number, so clearing it for
 * the child clears it for the SPAWNER TOO.
 *
 * Measured on one `os dev`-shaped run over an unbuilt workspace, sampling
 * `/proc/PID/fdinfo/2` from outside the process every 50 ms:
 *
 * ```
 *  102ms pid=19236 O_NONBLOCK=true            (process.stderr materialised)
 * 1132ms pid=19236 O_NONBLOCK=false           (esbuild service spawned; same sample)
 * 1132ms pid=19248 …/@esbuild/linux-x64/bin/esbuild --service=…
 * 2730ms pid=19236 O_NONBLOCK=false inWrite=true
 * ```
 *
 * and from there the main thread never left `write(2)`:
 *
 * ```
 * pid=19236 state=S syscall=1(write) args=0x2,…,0x244 wchan=sock_alloc_send_pskb
 *     tid=19236 (node) syscall=1(write)      ← the MAIN thread
 * ```
 *
 * With the loop parked in the kernel there is no late timer to catch up: the
 * no-progress bound is not slow, it is UNREACHABLE, and no ceiling of any size
 * distinguishes that from a wait. The process ends only when someone reads the
 * pipe or kills it. That is the hang.
 *
 * ⚠️ Nothing in the spawn is ours. The service is esbuild's, spawned by `tsx`
 * when it has to transform a module, which is why this reproduces on a COLD
 * transform cache (a fresh CI checkout) and almost never on a warm developer
 * box: measured 27 of 30 cold against 1 of 90 warm.
 *
 * ## Why the re-assert is on the WRITE path and not done once at startup
 *
 * Because the clearing happens at 1132 ms and is caused by a spawn this process
 * does not control or even know about. A one-shot at module top is undone by
 * the next `spawn(…, { stdio: 'inherit' })` anywhere in the process — including
 * from a module-hooks worker thread, which shares the same descriptions — and
 * it fails SILENTLY, back into the hang it was meant to prevent. Re-asserting
 * immediately before each write costs one `fcntl` and cannot be outrun by a
 * later spawn, whoever makes it.
 *
 * ## ⛔ This is not the prohibited call, it is its inverse
 *
 * `run-dev.js` and `src/utils/format.ts` both refuse
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
 * @param {NodeJS.WriteStream} [stream] The stream to guard; defaults to
 *   `process.stderr`. Parameterised for the pin, which drives the guard against
 *   a manufactured blocking pipe rather than waiting for a cold cache.
 * @returns {boolean} `true` when this process's writes are now guarded,
 *   `false` when there was nothing to guard (a TTY, a file, a stream with no
 *   libuv handle). The boolean is returned rather than logged: a reporter that
 *   announces itself on the very stream it is repairing is the one thing this
 *   file must not do.
 */
export function keepStderrNonBlocking(stream = process.stderr) {
  if (!stream || stream.isTTY === true) return false;
  const handle = stream._handle;
  if (!handle || typeof handle.setBlocking !== 'function') return false;
  if (stream[INSTALLED]) return true;

  const write = stream.write;
  if (typeof write !== 'function') return false;

  stream[INSTALLED] = true;
  stream.write = function guardedWrite(...args) {
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
