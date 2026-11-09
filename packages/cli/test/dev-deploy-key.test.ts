// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os dev`'s deploy key (#30871, scope amendment item 2): pressing `d` runs
 * the deploy path; with no cloud login it logs in first. Never a save hook —
 * nothing here is reachable from the watcher, only from a key.
 *
 * The key handler is driven through a fake terminal; the child it runs is
 * checked at the spawn seam (`runCliChild`), so no CLI is started.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const spawnCalls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv | undefined }> = [];
vi.mock('node:child_process', () => ({
  spawn: (command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    spawnCalls.push({ command, args, env: options?.env });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 0, null));
    return child;
  },
}));

const { attachDeployKey, deployKeyHint, runCliChild } = await import('../src/utils/dev-deploy-key.js');

const HERE = dirname(fileURLToPath(import.meta.url));

class FakeTerminal extends EventEmitter {
  isTTY = true;
  raw = false;
  rawHistory: boolean[] = [];
  setRawMode(mode: boolean) { this.raw = mode; this.rawHistory.push(mode); return this; }
  setEncoding() { return this; }
  resume() { return this; }
  pause() { return this; }
  press(key: string) { this.emit('data', key); }
}

function harness(opts: { loggedIn: boolean; loginSucceeds?: boolean }) {
  const terminal = new FakeTerminal();
  const printed: string[] = [];
  let loggedIn = opts.loggedIn;
  const runDeploy = vi.fn(async () => {
    // The terminal is handed to the child while it runs.
    expect(terminal.raw, 'the deploy child must get a cooked terminal (a login prompt reads it)').toBe(false);
    return 0;
  });
  const runLogin = vi.fn(async () => {
    if (opts.loginSucceeds) loggedIn = true;
    return opts.loginSucceeds ? 0 : 1;
  });
  const onInterrupt = vi.fn();
  const handle = attachDeployKey({
    input: terminal,
    print: (line) => printed.push(line),
    isLoggedIn: async () => loggedIn,
    runDeploy,
    runLogin,
    onInterrupt,
  });
  return { terminal, printed, runDeploy, runLogin, onInterrupt, handle };
}

describe('os dev deploy key', () => {
  beforeEach(() => { spawnCalls.length = 0; });

  it('offers the deploy and runs the deploy path on d, then offers it again', async () => {
    const h = harness({ loggedIn: true });
    await h.handle!.offer();
    expect(h.printed).toEqual([deployKeyHint(true)]);
    expect(h.printed[0]).toContain('Press d to deploy');

    h.terminal.press('d');
    await h.handle!.current;

    expect(h.runDeploy).toHaveBeenCalledTimes(1);
    expect(h.runLogin).not.toHaveBeenCalled();
    expect(h.terminal.raw, 'the key is listening again after the deploy').toBe(true);
    expect(h.printed.at(-1)).toBe(deployKeyHint(true));
  });

  it('not logged in: the line offers login, and d logs in, then deploys', async () => {
    const h = harness({ loggedIn: false, loginSucceeds: true });
    await h.handle!.offer();
    expect(h.printed[0]).toBe(deployKeyHint(false));
    expect(h.printed[0]).toContain('log in to ObjectOS Cloud');

    h.terminal.press('d');
    await h.handle!.current;

    expect(h.runLogin).toHaveBeenCalledTimes(1);
    expect(h.runDeploy).toHaveBeenCalledTimes(1);
    expect(h.runLogin.mock.invocationCallOrder[0]).toBeLessThan(h.runDeploy.mock.invocationCallOrder[0]);
  });

  it('a login that does not complete deploys nothing', async () => {
    const h = harness({ loggedIn: false, loginSucceeds: false });

    h.terminal.press('d');
    await h.handle!.current;

    expect(h.runDeploy).not.toHaveBeenCalled();
    expect(h.printed.join('\n')).toContain('nothing was deployed');
  });

  it('ignores a second d while a deploy runs, and every other key', async () => {
    const h = harness({ loggedIn: true });
    h.terminal.press('x');
    h.terminal.press('d');
    h.terminal.press('d');
    await h.handle!.current;
    expect(h.runDeploy).toHaveBeenCalledTimes(1);
  });

  it('forwards Ctrl-C, which raw mode swallows, as an interrupt', () => {
    const h = harness({ loggedIn: true });
    h.terminal.press('\u0003');
    expect(h.onInterrupt).toHaveBeenCalledTimes(1);
  });

  it('attaches nothing to a terminal that is not a TTY', () => {
    const terminal = new FakeTerminal();
    terminal.isTTY = false;
    const handle = attachDeployKey({
      input: terminal, print: () => {}, isLoggedIn: async () => true,
      runDeploy: async () => 0, runLogin: async () => 0, onInterrupt: () => {},
    });
    expect(handle).toBeUndefined();
    expect(terminal.rawHistory).toEqual([]);
  });

  it('runs the real `os deploy` child, without the LOCAL environment id', async () => {
    const before = process.env.OS_ENVIRONMENT_ID;
    process.env.OS_ENVIRONMENT_ID = 'env_local';
    try {
      expect(await runCliChild('/path/to/bin/run.js', ['deploy'])).toBe(0);
    } finally {
      if (before === undefined) delete process.env.OS_ENVIRONMENT_ID;
      else process.env.OS_ENVIRONMENT_ID = before;
    }
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe(process.execPath);
    expect(spawnCalls[0].args).toEqual(['/path/to/bin/run.js', 'deploy']);
    expect(
      spawnCalls[0].env?.OS_ENVIRONMENT_ID,
      'under os dev OS_ENVIRONMENT_ID names the local environment; os deploy reads it as the cloud --env',
    ).toBeUndefined();
  });

  it('is wired into os dev, which starts it once its first server listens', () => {
    const dev = readFileSync(resolve(HERE, '../src/commands/dev.ts'), 'utf8');
    expect(dev).toMatch(/import \{ startDevDeployKey[^}]*\} from '\.\.\/utils\/dev-deploy-key\.js';/);
    expect(dev).toMatch(/if \(!deployKey\) deployKey = startDevDeployKey\(binPath,/);
  });
});

describe('os dev deploy key — a self-hosted runtime as the active target (#30888)', () => {
  it('names the runtime, and d runs `os deploy` with no cloud login asked for', async () => {
    const terminal = new FakeTerminal();
    const printed: string[] = [];
    const runDeploy = vi.fn(async () => 0);
    const runLogin = vi.fn(async () => 0);
    const handle = attachDeployKey({
      input: terminal,
      print: (line) => printed.push(line),
      isLoggedIn: async () => false,
      runDeploy,
      runLogin,
      runtimeTarget: async () => 'http://runtime.test:8080',
      onInterrupt: () => {},
    });
    await handle!.offer();
    expect(printed[0]).toBe(deployKeyHint(false, 'http://runtime.test:8080'));
    expect(printed[0]).toContain('to the self-hosted runtime http://runtime.test:8080');

    terminal.press('d');
    await handle!.current;
    expect(runLogin).not.toHaveBeenCalled();
    expect(runDeploy).toHaveBeenCalledTimes(1);
  });

  it('is wired to the remembered target in os dev', () => {
    const source = readFileSync(resolve(HERE, '../src/utils/dev-deploy-key.ts'), 'utf8');
    expect(source).toMatch(/runtimeTarget: async \(\) => \(await activeRuntimeTarget\(\)/);
  });
});
