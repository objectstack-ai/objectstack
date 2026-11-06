// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os dev`'s deploy key: once the local server is up, the last line says
 * "press d to deploy", and pressing `d` runs `os deploy` in the same terminal.
 * Not logged in, the same key logs in first (`os cloud login`), then deploys.
 *
 * ⛔ A KEY, never a save hook. On ObjectOS Cloud an organization's one
 * environment is its production (cloud ADR-0024): every deploy is a person's
 * deliberate act, so nothing here is wired to the watcher.
 *
 * ## Why the deploy runs as a child `os deploy`
 *
 * The key runs exactly the command a developer would type — one deploy path,
 * whose output, refusals and exit status are the ones `os deploy` documents.
 * While the child runs, this module hands the terminal back (raw mode off, its
 * listener removed) so a login prompt in the child reads the keyboard; it
 * takes the terminal again when the child exits.
 *
 * Raw mode swallows the terminal's Ctrl-C, so Ctrl-C is forwarded as SIGINT to
 * this process — the path `os dev` already shuts down on.
 *
 * No TTY (piped stdin, CI, a backgrounded `os dev`): nothing is attached and
 * no line is printed — a key nobody can press is not offered.
 */

import { spawn } from 'node:child_process';
import { tryReadCloudConfig } from './cloud-config.js';

/** The slice of `process.stdin` this module uses — a fake in tests. */
export interface DeployKeyInput {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  setEncoding?(encoding: BufferEncoding): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: 'data', listener: (chunk: string | Buffer) => void): unknown;
  off(event: 'data', listener: (chunk: string | Buffer) => void): unknown;
}

export interface DeployKeyOptions {
  input: DeployKeyInput;
  print: (line: string) => void;
  /** True when a cloud credential is available (`cloud.json`, OS_CLOUD_API_KEY, OS_TOKEN). */
  isLoggedIn: () => Promise<boolean>;
  /** Runs `os cloud login`; resolves to its exit status. */
  runLogin: () => Promise<number>;
  /** Runs `os deploy`; resolves to its exit status. */
  runDeploy: () => Promise<number>;
  /** Ctrl-C while the terminal is raw. */
  onInterrupt: () => void;
}

export interface DeployKeyHandle {
  /** Print the offer line (on boot, and after each deploy). */
  offer(): Promise<void>;
  /** Restore the terminal and stop listening. */
  detach(): void;
  /** The pending key action, for tests. */
  readonly current: Promise<void> | undefined;
}

/** The offer line, by whether a cloud credential is available. */
export function deployKeyHint(loggedIn: boolean): string {
  return loggedIn
    ? 'Press d to deploy this app to your ObjectOS Cloud environment (runs `os deploy`).'
    : 'Press d to log in to ObjectOS Cloud and deploy this app (runs `os cloud login`, then `os deploy`).';
}

/**
 * Attach the key to `input`. Returns `undefined`, attaching nothing, when the
 * input is not a TTY.
 */
export function attachDeployKey(options: DeployKeyOptions): DeployKeyHandle | undefined {
  const { input, print } = options;
  if (!input.isTTY || typeof input.setRawMode !== 'function') return undefined;

  let listening = false;
  let current: Promise<void> | undefined;

  const listen = () => {
    if (listening) return;
    input.setRawMode!(true);
    input.setEncoding?.('utf8');
    input.on('data', onData);
    input.resume();
    listening = true;
  };
  const release = () => {
    if (!listening) return;
    input.off('data', onData);
    input.setRawMode!(false);
    input.pause();
    listening = false;
  };

  const offer = async () => {
    print(deployKeyHint(await options.isLoggedIn()));
  };

  const act = async () => {
    release();
    try {
      if (!(await options.isLoggedIn())) {
        const login = await options.runLogin();
        if (login !== 0 || !(await options.isLoggedIn())) {
          print('Not logged in to ObjectOS Cloud, so nothing was deployed. Press d to try again.');
          return;
        }
      }
      const status = await options.runDeploy();
      if (status !== 0) print(`os deploy exited with status ${status} — see above. Press d to try again.`);
    } finally {
      listen();
    }
    await offer();
  };

  function onData(chunk: string | Buffer) {
    const key = String(chunk);
    if (key === '\u0003') {
      options.onInterrupt();
      return;
    }
    if (key !== 'd' && key !== 'D') return;
    if (current) return;
    current = act().finally(() => { current = undefined; });
  }

  listen();
  return {
    offer,
    detach: release,
    get current() { return current; },
  };
}

/** A cloud credential `os deploy` would find: an API key in the environment, or `os cloud login`'s. */
export async function hasCloudCredential(): Promise<boolean> {
  if (process.env.OS_CLOUD_API_KEY || process.env.OS_TOKEN) return true;
  return Boolean((await tryReadCloudConfig())?.token);
}

/**
 * Run `os <args>` as a child on this terminal; resolve to its exit status.
 *
 * `OS_ENVIRONMENT_ID` is withheld from the child. Under `os dev` that variable
 * names the LOCAL environment (`--environment-id`'s fallback, `env_local` by
 * default), and `os deploy` reads the same variable as its cloud `--env` — so
 * inheriting it would aim the deploy at an id that exists only on this machine.
 * No `NODE_ENV` is written (`commands/child-env-source-loader.pin.test.ts`).
 */
export function runCliChild(binPath: string, args: string[]): Promise<number> {
  const env = { ...process.env };
  delete env.OS_ENVIRONMENT_ID;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [binPath, ...args], { stdio: 'inherit', env });
    child.on('error', () => resolve(1));
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/**
 * `os dev`'s one call: attach the key to this process's terminal and print the
 * offer. Called once, when the first server is listening. No TTY → nothing.
 */
export function startDevDeployKey(binPath: string, print: (line: string) => void): DeployKeyHandle | undefined {
  const handle = attachDeployKey({
    input: process.stdin,
    print,
    isLoggedIn: hasCloudCredential,
    runLogin: () => runCliChild(binPath, ['cloud', 'login']),
    runDeploy: () => runCliChild(binPath, ['deploy']),
    onInterrupt: () => { process.kill(process.pid, 'SIGINT'); },
  });
  if (!handle) return undefined;
  process.on('exit', () => handle.detach());
  void handle.offer();
  return handle;
}
