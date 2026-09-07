// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ONE project publishing its runtime state file, as a REAL separate process.
 *
 * `serve-runtime-state-project-key.test.ts` drives several of these at once to
 * ask a question a single process cannot answer: what happens on a machine
 * where TWO projects are serving. Two things about that are only observable
 * across processes —
 *
 *   • each child has its OWN pid, so "the second boot's record replaced the
 *     first's" is a reading rather than an artefact of one process writing
 *     twice; and
 *   • `runtimeBoundPortChannels` registers an `exit` cleanup per file it
 *     writes, so "whose record does a shutdown delete" needs a process that
 *     can shut down while another keeps running.
 *
 * ⛔ It writes through the REAL channel — `runtimeBoundPortChannels`, the
 * object `os serve` itself publishes with — reached by a RELATIVE import into
 * `packages/cli/src`, never through the package name. A bare
 * `@objectstack/cli` specifier would resolve through `exports` to `dist/` and
 * turn every verdict below into a statement about build state.
 *
 * ⛔ It does NOT boot a server. What is under test is the NAME the state file
 * is keyed by; a listening socket adds cost and a port race to a question that
 * has neither.
 *
 * Protocol: argv[2] is the port to publish, argv[3] a fixed project root the
 * child names a file for so the caller can compare that naming with its own.
 * One JSON line is written to stdout once the file is on disk. The child then
 * stays alive until its stdin closes, and exits CLEANLY on that — a signal
 * would skip the `exit` listener whose behaviour is half of what the caller is
 * measuring.
 *
 * ⛔ This module EXPORTS nothing and is never imported: its body runs on
 * import, so an `export` here would invite a caller to pull the constant in and
 * take a `process.exit(2)` with it. Both arguments come over argv instead.
 */

import { runtimeBoundPortChannels, runtimeStateFileName } from '../../src/commands/serve.js';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  process.stderr.write('runtime-state-child: argv[2] must be a positive integer port\n');
  process.exit(2);
}

runtimeBoundPortChannels(() => { /* no banner: this child publishes one channel */ })
  .writeRuntimeState({ port, url: `http://localhost:${port}` });

process.stdout.write(`${JSON.stringify({
  pid: process.pid,
  port,
  cwd: process.cwd(),
  home: process.env.OS_HOME,
  // The name this child's OWN copy of the writer produces, for a fixed root.
  // The caller recomputes it from its own import and compares: two independent
  // resolutions of the same source agreeing is what rules out a stale build
  // answering for either side.
  namingControl: runtimeStateFileName('env_local', process.argv[3] ?? ''),
})}\n`);

process.stdin.resume();
process.stdin.on('end', () => { process.exit(0); });
