#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A stand-in for an external agent command (`--driver external:COMMAND`), for
 * the runner's tests: it speaks the stdin/stdout contract and reports what it
 * saw of the persona's key — never the key itself.
 *
 *   - `info`: `{ name: 'fake-agent', version: '1.2.3' }`, or, by
 *     `FAKE_DRIVER_INFO`, an exit 4 (`crash`) or a non-JSON answer (`garbage`).
 *   - With `FAKE_DRIVER_SCRIPT=DIR`, an `author` or `ask` call answers the turn
 *     the test wrote for its step (`DIR/<encoded step key>.json`).
 *   - Otherwise the prompt's first word decides: `HANG` waits to be killed
 *     (exit 143 on SIGTERM), `CRASH` exits 3, `GARBAGE` prints prose, `SHAPE`
 *     prints JSON of another shape, anything else echoes the call it read.
 *   - With `FAKE_DRIVER_LOG=FILE`, every call appends one line: its kind, its
 *     step and, for an ask, what it saw of the key — the config file's mode, a
 *     SHA-256 of the key it read there, and whether the key was also on argv,
 *     in the environment or on stdin.
 */

import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

process.on('SIGTERM', () => {
  process.stderr.write('fake: terminated\n');
  process.exit(143);
});

const out = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);
const sha = (s) => createHash('sha256').update(s).digest('hex');

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  const call = JSON.parse(raw);
  if (call.contract !== 'objectstack-scenario-driver/1') {
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
    out({ name: 'fake-agent', version: '1.2.3' });
    return;
  }

  let seen;
  if (call.kind === 'ask') {
    const file = call.mcp.configFile;
    const config = JSON.parse(readFileSync(file, 'utf8'));
    const key = config.mcpServers.app.headers.Authorization.replace(/^Bearer /, '');
    seen = {
      configFile: file,
      fileMode: (statSync(file).mode & 0o777).toString(8),
      urlMatches: config.mcpServers.app.url === call.mcp.url,
      runsInConfigDir: process.cwd() === dirname(file),
      keySha: sha(key),
      keyOnArgv: process.argv.some((a) => a.includes(key)),
      keyInEnv: Object.values(process.env).some((v) => typeof v === 'string' && v.includes(key)),
      keyOnStdin: raw.includes(key),
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
  });
});
