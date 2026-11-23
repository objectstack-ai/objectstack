// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The CLI's one way to open a page in the user's browser — the sign-in page
 * of `os login` and `os cloud login`'s device flow.
 *
 * Two rules, both checked before anything is launched:
 *
 *   1. **Only an http or https address is opened.** The address is parsed
 *      with `new URL`; anything else (no scheme, `file:`, a custom protocol, a
 *      string that does not parse) is never handed to the operating system.
 *      The caller prints the address for the user to open themselves.
 *   2. **The opener runs without a shell.** The program and its arguments go
 *      to `spawn` as an argv array with `shell: false`, so the address is one
 *      argument and nothing in it is ever read as shell syntax. The address
 *      handed over is the parser's normalised `href`, never the raw string.
 *
 * Per platform:
 *
 *   - macOS: `open URL`.
 *   - Windows: `rundll32.exe url.dll,FileProtocolHandler URL`, named by its
 *     absolute path under `%SystemRoot%\System32`. `start`, the usual
 *     spelling, is a `cmd.exe` builtin and cannot run without a shell;
 *     `FileProtocolHandler` hands the address to the shell-execute API, which
 *     opens it with the default browser for `http:`/`https:`. A normalised
 *     `href` holds no space or double quote (both are percent-encoded), so
 *     Node passes it to `rundll32` as one unquoted argument.
 *   - Everything else: `xdg-open URL`.
 *
 * Best-effort, as before: a missing opener (`xdg-open` not installed) is
 * swallowed, and the address the caller printed is the fallback.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

/** One opener invocation: the program and its argv, never a command line. */
export interface BrowserLaunch {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * The address as the normalised `href` of an `http:` or `https:` URL, or
 * `undefined` for anything else — which is then never launched.
 */
export function browsableUrl(raw: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  return parsed.href;
}

/** The opener for `href` on `platform`; `href` must already be {@link browsableUrl}'s answer. */
export function browserLaunch(
  href: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): BrowserLaunch {
  if (platform === 'darwin') return { command: 'open', args: [href] };
  if (platform === 'win32') {
    const systemRoot = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows';
    return {
      command: path.win32.join(systemRoot, 'System32', 'rundll32.exe'),
      args: ['url.dll,FileProtocolHandler', href],
    };
  }
  return { command: 'xdg-open', args: [href] };
}

/** Starts the opener. A seam, so a test can stand in for the operating system. */
export const browserLauncher = {
  launch(launch: BrowserLaunch): void {
    const child = spawn(launch.command, [...launch.args], { stdio: 'ignore', shell: false, windowsHide: true });
    child.on('error', () => {
      /* best-effort: the printed address is the fallback */
    });
    child.unref();
  },
};

/**
 * Opens `raw` in the default browser when it is an http or https address.
 * Answers whether an opener was started, so the caller says "opened" only
 * when it was.
 */
export function openBrowser(raw: string, platform: NodeJS.Platform = process.platform): boolean {
  const href = browsableUrl(raw);
  if (href === undefined) return false;
  try {
    browserLauncher.launch(browserLaunch(href, platform));
  } catch {
    return false;
  }
  return true;
}

/** What the device flow prints after {@link openBrowser}, for either answer. */
export function browserOpenNotice(opened: boolean): string {
  return opened
    ? '  (Browser opened automatically. Press Ctrl+C to cancel.)'
    : '  (Not opened in a browser: the sign-in address is not an http or https address. '
      + 'Open it yourself only if you recognise it.)';
}
