// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where the print service's one engine, headless Chromium, runs — and where it
 * loads the console from.
 *
 * ## One engine, two placements
 *
 * The driver is headless Chromium and nothing else: a print page is a page
 * model, and only a browser renders it the way the console prints it. It has
 * two placements, and a deployment configures exactly one:
 *
 *  - **local** — a Chromium executable on this host, launched per render
 *    (`chromiumPath`, or `OS_PRINT_CHROMIUM_PATH`). Self-hosted deployments.
 *  - **remote** — a browser this deployment reaches over the Chrome DevTools
 *    Protocol at a WebSocket endpoint (`browserEndpoint`, or
 *    `OS_PRINT_BROWSER_ENDPOINT`), connected per render. A deployment whose
 *    hosts cannot carry a browser of their own.
 *
 * Both need `consoleUrl` (or `OS_PRINT_CONSOLE_URL`): the URL the browser
 * loads this deployment's console from, `/_console` included — for the local
 * placement usually this host's own address, for the remote one an address
 * that browser can reach. A plugin option wins over its environment variable.
 *
 * Nothing here is guessed. No placement configured is `unconfigured`; both
 * placements configured, or a value that will not parse, is `misconfigured`
 * and names the value to fix. The plugin says so once at `start()`, and the
 * service refuses every render until it is fixed.
 *
 * ## Credentials on the wire
 *
 * The minted session cookie travels to the browser in the DevTools protocol's
 * own frames. On a `ws://` endpoint that is cleartext: use `wss://` for a
 * remote browser off this host, and `ws://` only on loopback. The console URL
 * carries no credentials of its own — one with `user:password@` is refused.
 *
 * ## The remote endpoint may carry a secret
 *
 * A hosted browser commonly authenticates the WebSocket by a token in the
 * endpoint's query string. The endpoint therefore never appears in a log line
 * or an error message: {@link describeEndpoint} gives the scheme and host only.
 */

/** The environment variable naming a local Chromium executable. */
export const PRINT_CHROMIUM_PATH_ENV = 'OS_PRINT_CHROMIUM_PATH';
/** The environment variable naming a remote browser's DevTools WebSocket endpoint. */
export const PRINT_BROWSER_ENDPOINT_ENV = 'OS_PRINT_BROWSER_ENDPOINT';
/** The environment variable naming the URL the browser loads the console from. */
export const PRINT_CONSOLE_URL_ENV = 'OS_PRINT_CONSOLE_URL';

/** Where the Chromium engine runs. */
export type PrintPlacement = 'local' | 'remote';

/** What a deployment configures, as plugin options. Each wins over its environment variable. */
export interface PrintPlacementOptions {
  /** A local Chromium executable. Environment: `OS_PRINT_CHROMIUM_PATH`. */
  chromiumPath?: string;
  /**
   * A remote browser's Chrome DevTools Protocol WebSocket endpoint
   * (`ws://` or `wss://`). Environment: `OS_PRINT_BROWSER_ENDPOINT`.
   */
  browserEndpoint?: string;
  /**
   * The URL the browser loads this deployment's console from, `/_console`
   * included (`http://127.0.0.1:3000/_console`). Environment:
   * `OS_PRINT_CONSOLE_URL`.
   */
  consoleUrl?: string;
}

/** A placement that is fully configured. */
export interface ResolvedPrintPlacement {
  placement: PrintPlacement;
  /** The executable (local) or the endpoint (remote). The endpoint is a secret: never log it. */
  target: string;
  /** The console URL, without a trailing slash. */
  consoleUrl: string;
}

/** The configuration as read: a placement, or why there is none. */
export type PrintPlacementResolution =
  | { state: 'configured'; resolved: ResolvedPrintPlacement }
  | { state: 'unconfigured'; reason: string }
  | { state: 'misconfigured'; placement: PrintPlacement | null; reason: string };

const UNCONFIGURED_REASON =
  'No print engine is configured, so no record can be printed to a file. Set ' +
  `${PRINT_CHROMIUM_PATH_ENV} (a local Chromium executable) or ${PRINT_BROWSER_ENDPOINT_ENV} (a remote ` +
  `browser's DevTools WebSocket endpoint), and ${PRINT_CONSOLE_URL_ENV} (the URL the browser loads the console ` +
  'from) — or the matching PrintServicePlugin options.';

/** A configured value: a non-empty string after trimming, or nothing. */
function setting(option: string | undefined, env: string | undefined): string | undefined {
  const value = option !== undefined ? option : env;
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The scheme and host of an endpoint, for a log line or a message — never its
 * path or query, which may carry a token. An endpoint that does not parse is
 * described as such, without its text.
 */
/**
 * The console URL as a log line or a status may name it: its scheme and host,
 * never its path, credentials or query — or, for a value that does not parse,
 * a statement that it does not, never the value.
 */
export function describeConsoleUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '(a value that is not a URL)';
  }
}

/** {@link describeConsoleUrl}'s counterpart for the remote endpoint. */
export function describeEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '(an endpoint that is not a URL)';
  }
}

/**
 * Read the placement from the plugin options and the environment. Pure: the
 * same inputs always give the same answer, so it is pinned per case.
 */
export function resolvePrintPlacement(
  options: PrintPlacementOptions,
  env: Readonly<Record<string, string | undefined>>,
): PrintPlacementResolution {
  const chromiumPath = setting(options.chromiumPath, env[PRINT_CHROMIUM_PATH_ENV]);
  const browserEndpoint = setting(options.browserEndpoint, env[PRINT_BROWSER_ENDPOINT_ENV]);
  const consoleUrl = setting(options.consoleUrl, env[PRINT_CONSOLE_URL_ENV]);

  if (chromiumPath === undefined && browserEndpoint === undefined) {
    return { state: 'unconfigured', reason: UNCONFIGURED_REASON };
  }
  if (chromiumPath !== undefined && browserEndpoint !== undefined) {
    return {
      state: 'misconfigured',
      placement: null,
      reason:
        `Both print placements are configured: a local executable (${PRINT_CHROMIUM_PATH_ENV} or chromiumPath) ` +
        `and a remote endpoint (${PRINT_BROWSER_ENDPOINT_ENV} or browserEndpoint). The engine runs in one ` +
        'place — remove one of them.',
    };
  }

  const placement: PrintPlacement = chromiumPath !== undefined ? 'local' : 'remote';
  if (placement === 'remote') {
    let protocol: string | null = null;
    try {
      protocol = new URL(browserEndpoint!).protocol;
    } catch {
      protocol = null;
    }
    if (protocol !== 'ws:' && protocol !== 'wss:') {
      return {
        state: 'misconfigured',
        placement,
        reason:
          `The remote print endpoint (${PRINT_BROWSER_ENDPOINT_ENV} or browserEndpoint) must be a ws:// or ` +
          `wss:// DevTools WebSocket URL; the configured value is ${describeEndpoint(browserEndpoint!)}.`,
      };
    }
  }

  if (consoleUrl === undefined) {
    return {
      state: 'misconfigured',
      placement,
      reason:
        `The ${placement} print engine is configured, but ${PRINT_CONSOLE_URL_ENV} (or consoleUrl) is not: the ` +
        'browser has no URL to load the console from. Set it to the console URL that browser can reach, ' +
        '/_console included.',
    };
  }
  let parsedConsole: URL | null = null;
  try {
    parsedConsole = new URL(consoleUrl);
  } catch {
    parsedConsole = null;
  }
  if (parsedConsole && (parsedConsole.username !== '' || parsedConsole.password !== '')) {
    // Credentials in the URL would ride every request the browser makes and
    // every line that names the URL; the value is not echoed here either.
    return {
      state: 'misconfigured',
      placement,
      reason:
        `${PRINT_CONSOLE_URL_ENV} (or consoleUrl) carries credentials (user:password@); the browser signs in with ` +
        "the requesting user's own session, so the URL must carry none. Remove them.",
    };
  }
  if (!parsedConsole || (parsedConsole.protocol !== 'http:' && parsedConsole.protocol !== 'https:')) {
    return {
      state: 'misconfigured',
      placement,
      reason: `${PRINT_CONSOLE_URL_ENV} (or consoleUrl) must be an http:// or https:// URL; it is ${describeConsoleUrl(consoleUrl)}.`,
    };
  }
  if (parsedConsole.search !== '' || parsedConsole.hash !== '') {
    return {
      state: 'misconfigured',
      placement,
      reason: `${PRINT_CONSOLE_URL_ENV} (or consoleUrl) must be the console's base URL, with no query or fragment; it is ${describeConsoleUrl(consoleUrl)} with a query or fragment.`,
    };
  }

  return {
    state: 'configured',
    resolved: {
      placement,
      target: placement === 'local' ? chromiumPath! : browserEndpoint!,
      consoleUrl: consoleUrl.replace(/\/+$/, ''),
    },
  };
}
