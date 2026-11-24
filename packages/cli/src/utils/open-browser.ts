// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The CLI's one way to open a page in the user's browser — the sign-in page
 * of `os login` and `os cloud login`'s device flow.
 *
 * Two rules, both checked before anything is launched:
 *
 *   1. **Only an http or https address is opened, and only one written in
 *      a conservative character set.** The address is parsed with `new URL`;
 *      anything else (no scheme, `file:`, a custom protocol, a string that does
 *      not parse) is never handed to the operating system, and neither is a
 *      normalised `href` holding any character outside
 *      {@link BROWSABLE_CHARACTERS}. The caller prints the address for the
 *      user to open themselves.
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
 *     opens it with the default browser for `http:`/`https:`. The address
 *     handed over holds no space and no double quote, because rule 1 refuses
 *     every `href` that holds either, so Node passes it to `rundll32` as one
 *     unquoted argument.
 *   - Everything else: `xdg-open URL`.
 *
 * Best-effort, as before: an opener that fails after it was started (say,
 * `xdg-open` not installed) is swallowed, and the address the caller printed
 * is the fallback. "Opened" therefore means the opener was started.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

/** One opener invocation: the program and its argv, never a command line. */
export interface BrowserLaunch {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * Every character an opened address may hold: the characters RFC 3986 lets a
 * URI hold (letters, digits, `-._~`, the delimiters `:/?#[]@!$&'()*+,;=`, and
 * `%` for percent-encoding). No space, no double quote, none of `<`, `>`, a
 * backslash, `^`, a backtick, `{`, `|` or `}`, no control character and
 * nothing outside ASCII.
 */
export const BROWSABLE_CHARACTERS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;

/**
 * The address as the normalised `href` of an `http:` or `https:` URL written
 * in {@link BROWSABLE_CHARACTERS}, or `undefined` for anything else — which is
 * then never launched.
 */
export function browsableUrl(raw: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  return BROWSABLE_CHARACTERS.test(parsed.href) ? parsed.href : undefined;
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
 * What {@link openBrowser} did: started an opener, refused an address that is
 * not one it opens, or failed to start the opener.
 */
export type BrowserOpenResult = 'opened' | 'not-browsable' | 'not-started';

/**
 * Opens `raw` in the default browser when {@link browsableUrl} accepts it.
 * Answers what happened, so the caller says "opened" only when an opener was
 * started, and gives the right reason when it was not.
 */
export function openBrowser(raw: string, platform: NodeJS.Platform = process.platform): BrowserOpenResult {
  const href = browsableUrl(raw);
  if (href === undefined) return 'not-browsable';
  try {
    browserLauncher.launch(browserLaunch(href, platform));
  } catch {
    return 'not-started';
  }
  return 'opened';
}

/** What the device flow prints after {@link openBrowser}, for each answer. */
export function browserOpenNotice(result: BrowserOpenResult): string {
  if (result === 'opened') return '  (Browser opened automatically. Press Ctrl+C to cancel.)';
  if (result === 'not-started') return '  (Could not start a browser. Open the sign-in address above yourself.)';
  return '  (Not opened in a browser: the sign-in address is not an http or https address in plain URL characters. '
    + 'Open it yourself only if you recognise it.)';
}
