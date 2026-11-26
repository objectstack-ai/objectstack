#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A stand-in for an external agent command (`--driver external:COMMAND`), for
 * the runner's tests: it speaks the stdin/stdout contract and reports what it
 * saw of the persona's key — never the key itself.
 *
 *   - `info` (always sent as `objectstack-scenario-driver/1`):
 *     `{ name: 'fake-agent', version: '1.2.3', contract: '…/2' }`, or, by
 *     `FAKE_DRIVER_INFO`, an exit 4 (`crash`) or a non-JSON answer (`garbage`).
 *     `FAKE_DRIVER_CONTRACT=1` makes it a `/1` command (its answer names no
 *     contract); any other value is named in the answer as given. Every later
 *     call must carry the contract it named, or it exits 2.
 *   - A door `author` call (contract `/2`, `door` on the input) reports what
 *     it saw of the door's token, as an ask reports the key, and the skills it
 *     found in `door.skillsDir`.
 *   - With `FAKE_DRIVER_SCRIPT=DIR`, an `author` or `ask` call answers the turn
 *     the test wrote for its step (`DIR/<encoded step key>.json`).
 *   - Otherwise the prompt's first word decides: `HANG` waits to be killed
 *     (exit 143 on SIGTERM), `CRASH` exits 3, `GARBAGE` prints prose, `SHAPE`
 *     prints JSON of another shape, anything else echoes the call it read.
 *   - With `FAKE_DRIVER_USAGE=JSON`, the echo answer also carries those keys
 *     (the usage fields: `reportedCostUsd`, `inputTokens`, `outputTokens`);
 *     without it the answer reports no usage at all.
 *   - With `FAKE_DRIVER_LOG=FILE`, every call appends one line: its kind, its
 *     step and, for an ask, what it saw of the key — the config file's mode, a
 *     fingerprint of the key it read there (FNV-1a, not the key), and whether
 *     the key was also on argv, in the environment or on stdin.
 *
 * Every turn of a card run starts this file once, one after another, so its
 * start-up is the e2e case's cost: it loads `node:fs` and `node:path` only.
 * `node:crypto` added ~7 ms a start (41–45 ms against 35–39 ms for a bare
 * node on the box that measured it), and the fingerprint only has to tell this
 * run's few keys apart.
 */

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

process.on('SIGTERM', () => {
  process.stderr.write('fake: terminated\n');
  process.exit(143);
});

const out = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);
/** FNV-1a (32-bit) as hex; `keyPrint` in external-driver.test.ts is the same function. */
const keyPrint = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
};

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  const call = JSON.parse(raw);
  const speaks = process.env.FAKE_DRIVER_CONTRACT === undefined ? 'objectstack-scenario-driver/2' : process.env.FAKE_DRIVER_CONTRACT === '1' ? 'objectstack-scenario-driver/1' : process.env.FAKE_DRIVER_CONTRACT;
  const expected = call.kind === 'info' ? 'objectstack-scenario-driver/1' : speaks;
  if (call.contract !== expected) {
    process.stderr.write(`fake: unknown contract ${call.contract}\n`);
    process.exit(2);
  }
  if (call.kind === 'info') {
    const how = process.env.FAKE_DRIVER_INFO ?? 'ok';
    if (how === 'crash') {
      process.stderr.write('fake: no info for you\n');
      process.exit(4);
    }
    if (how === 'garbage') {
      process.stdout.write('fake-agent, version one\n');
      process.exit(0);
    }
    out({ name: 'fake-agent', version: '1.2.3', ...(speaks === 'objectstack-scenario-driver/1' ? {} : { contract: speaks }) });
    return;
  }

  /** What a call saw of the secret in its 0600 MCP config file: never the secret itself. */
  const sawSecret = (mcp) => {
    const file = mcp.configFile;
    const config = JSON.parse(readFileSync(file, 'utf8'));
    const key = config.mcpServers.app.headers.Authorization.replace(/^Bearer /, '');
    return {
      configFile: file,
      fileMode: (statSync(file).mode & 0o777).toString(8),
      urlMatches: config.mcpServers.app.url === mcp.url,
      runsInConfigDir: process.cwd() === dirname(file),
      keyPrint: keyPrint(key),
      keyOnArgv: process.argv.some((a) => a.includes(key)),
      keyInEnv: Object.values(process.env).some((v) => typeof v === 'string' && v.includes(key)),
      keyOnStdin: raw.includes(key),
    };
  };
  let seen;
  if (call.kind === 'ask') seen = sawSecret(call.mcp);
  if (call.kind === 'author' && call.door) {
    const dir = call.door.skillsDir;
    seen = {
      ...sawSecret(call.door.mcp),
      runsInCwd: process.cwd() === call.cwd,
      skills: dir !== undefined && existsSync(dir) ? readdirSync(dir).sort() : [],
      skillMdOf: dir !== undefined && existsSync(dir) ? readdirSync(dir).sort().map((n) => existsSync(join(dir, n, 'SKILL.md'))) : [],
    };
  }
  if (process.env.FAKE_DRIVER_LOG) appendFileSync(process.env.FAKE_DRIVER_LOG, `${JSON.stringify({ kind: call.kind, step: call.step, ...(seen ? { seen } : {}) })}\n`);

  if (process.env.FAKE_DRIVER_SCRIPT) {
    const s = call.step;
    const key = [s.card, s.mode, s.phase, s.step, s.persona ?? '-'].join('/');
    process.stdout.write(readFileSync(join(process.env.FAKE_DRIVER_SCRIPT, `${encodeURIComponent(key)}.json`), 'utf8'));
    return;
  }

  const word = call.prompt.split(/\s/)[0];
  if (word === 'HANG') {
    setInterval(() => {}, 1000);
    return;
  }
  if (word === 'CRASH') {
    process.stderr.write('fake: gave up\n');
    process.exit(3);
  }
  if (word === 'GARBAGE') {
    process.stdout.write('Here is my answer: 42\n');
    return;
  }
  if (word === 'SHAPE') {
    out({ reply: 'the wrong key', toolCalls: [] });
    return;
  }
  out({
    replyText: JSON.stringify({ input: call, argv: process.argv.slice(2), cwd: process.cwd(), ...(seen ? { seen } : {}) }),
    toolCalls: [
      { name: 'mcp__app__query_records', input: { objectName: 'x' }, output: '{"records":[]}' },
      { name: 'update_record', input: { objectName: 'x' }, output: '{"error":{"code":"PERMISSION_DENIED"}}', isError: true },
    ],
    model: 'fake-model-1',
    numTurns: 2,
    ...(process.env.FAKE_DRIVER_USAGE ? JSON.parse(process.env.FAKE_DRIVER_USAGE) : {}),
  });
});
