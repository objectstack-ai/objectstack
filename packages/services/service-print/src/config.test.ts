// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  describeEndpoint,
  PRINT_BROWSER_ENDPOINT_ENV,
  PRINT_CHROMIUM_PATH_ENV,
  PRINT_CONSOLE_URL_ENV,
  resolvePrintPlacement,
} from './config.js';

const CONSOLE = 'http://127.0.0.1:3000/_console';
const SECRET_ENDPOINT = 'wss://browser.example.com/devtools/browser/abc?token=s3cr3t-value';

describe('resolvePrintPlacement — one engine, two placements', () => {
  it('nothing configured is unconfigured, and the reason names every variable to set', () => {
    const r = resolvePrintPlacement({}, {});
    expect(r.state).toBe('unconfigured');
    if (r.state !== 'unconfigured') return;
    for (const name of [PRINT_CHROMIUM_PATH_ENV, PRINT_BROWSER_ENDPOINT_ENV, PRINT_CONSOLE_URL_ENV]) {
      expect(r.reason).toContain(name);
    }
  });

  it('a blank value is not a value', () => {
    expect(resolvePrintPlacement({}, { [PRINT_CHROMIUM_PATH_ENV]: '   ' }).state).toBe('unconfigured');
  });

  it('a local executable from the environment', () => {
    const r = resolvePrintPlacement({}, { [PRINT_CHROMIUM_PATH_ENV]: '/usr/bin/chromium', [PRINT_CONSOLE_URL_ENV]: `${CONSOLE}/` });
    expect(r).toEqual({
      state: 'configured',
      resolved: { placement: 'local', target: '/usr/bin/chromium', consoleUrl: CONSOLE },
    });
  });

  it('a remote endpoint from the options, and an option wins over its variable', () => {
    const r = resolvePrintPlacement(
      { browserEndpoint: SECRET_ENDPOINT, consoleUrl: CONSOLE },
      { [PRINT_CONSOLE_URL_ENV]: 'http://elsewhere/_console' },
    );
    expect(r).toEqual({
      state: 'configured',
      resolved: { placement: 'remote', target: SECRET_ENDPOINT, consoleUrl: CONSOLE },
    });
  });

  it('both placements at once is misconfigured, never a silent pick', () => {
    const r = resolvePrintPlacement({ chromiumPath: '/usr/bin/chromium' }, { [PRINT_BROWSER_ENDPOINT_ENV]: SECRET_ENDPOINT, [PRINT_CONSOLE_URL_ENV]: CONSOLE });
    expect(r.state).toBe('misconfigured');
    if (r.state === 'misconfigured') expect(r.placement).toBeNull();
  });

  it('a remote endpoint that is not ws:// or wss:// is misconfigured, and its text never reaches the reason', () => {
    const r = resolvePrintPlacement({ browserEndpoint: 'https://browser.example.com/x?token=s3cr3t-value', consoleUrl: CONSOLE }, {});
    expect(r.state).toBe('misconfigured');
    if (r.state !== 'misconfigured') return;
    expect(r.reason).toContain('https://browser.example.com');
    expect(r.reason).not.toContain('s3cr3t-value');
  });

  it('an engine with no console URL is misconfigured, on either placement', () => {
    for (const options of [{ chromiumPath: '/usr/bin/chromium' }, { browserEndpoint: SECRET_ENDPOINT }]) {
      const r = resolvePrintPlacement(options, {});
      expect(r.state).toBe('misconfigured');
      if (r.state === 'misconfigured') expect(r.reason).toContain(PRINT_CONSOLE_URL_ENV);
    }
  });

  it('a console URL is never echoed: credentials with a non-numeric port, and a query, are described by scheme and host or as unparseable', () => {
    const unparseable = resolvePrintPlacement({ chromiumPath: '/c', consoleUrl: 'http://print:topsecret@127.0.0.1:abc/_console' }, {});
    expect(unparseable.state).toBe('misconfigured');
    if (unparseable.state === 'misconfigured') {
      expect(unparseable.reason).toContain('(a value that is not a URL)');
      expect(unparseable.reason).not.toContain('topsecret');
      expect(unparseable.reason).not.toContain('print:');
    }
    const query = resolvePrintPlacement({ chromiumPath: '/c', consoleUrl: 'http://127.0.0.1:3000/_console?token=topsecret' }, {});
    expect(query.state).toBe('misconfigured');
    if (query.state === 'misconfigured') {
      expect(query.reason).toContain('http://127.0.0.1:3000');
      expect(query.reason).not.toContain('topsecret');
    }
  });

  it('a console URL carrying credentials is misconfigured, and the credentials are not echoed', () => {
    const r = resolvePrintPlacement({ chromiumPath: '/c', consoleUrl: 'http://print:hunter2-secret@127.0.0.1:3000/_console' }, {});
    expect(r.state).toBe('misconfigured');
    if (r.state === 'misconfigured') {
      expect(r.reason).toContain(PRINT_CONSOLE_URL_ENV);
      expect(r.reason).not.toContain('hunter2-secret');
    }
  });

  it('a console URL that is not http(s), or carries a query, is misconfigured', () => {
    for (const consoleUrl of ['ftp://host/_console', 'not a url', `${CONSOLE}?x=1`]) {
      expect(resolvePrintPlacement({ chromiumPath: '/c', consoleUrl }, {}).state).toBe('misconfigured');
    }
  });
});

describe('describeEndpoint — the endpoint as a log line may name it', () => {
  it('keeps the scheme and host, drops the path and the token', () => {
    expect(describeEndpoint(SECRET_ENDPOINT)).toBe('wss://browser.example.com');
  });

  it('describes an unparseable endpoint without echoing it', () => {
    expect(describeEndpoint('token=s3cr3t-value')).not.toContain('s3cr3t');
  });
});
