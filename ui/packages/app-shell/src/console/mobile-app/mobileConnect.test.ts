// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Mobile App page's connect payload is built from the server's published
 * public base URL, sub-path mount included, normalised so it carries the
 * server's address and nothing else; a loopback or private address, or a
 * public host on plain http, is refused instead of encoded (objectstack#29314).
 */

import { describe, expect, it } from 'vitest';
import { mobileConnectLink, mobileConnectTarget, normalizeServerUrl } from './mobileConnect';

describe('mobileConnectTarget: the payload is the configured public URL', () => {
  it('a public origin becomes objectos://connect?server=<the URL, encoded>', () => {
    expect(mobileConnectTarget('https://os.acme.example')).toEqual({
      kind: 'ready',
      serverUrl: 'https://os.acme.example',
      connectLink: 'objectos://connect?server=https%3A%2F%2Fos.acme.example',
    });
  });

  it('a sub-path mount stays in the encoded server URL', () => {
    expect(mobileConnectTarget('https://acme.example/platform/os')).toEqual({
      kind: 'ready',
      serverUrl: 'https://acme.example/platform/os',
      connectLink: 'objectos://connect?server=https%3A%2F%2Facme.example%2Fplatform%2Fos',
    });
  });

  it('a port is kept, and the encoded URL decodes back to the configured one', () => {
    const target = mobileConnectTarget('https://os.acme.example:8443/os');
    expect(target.kind).toBe('ready');
    const link = (target as { connectLink: string }).connectLink;
    expect(new URL(link).searchParams.get('server')).toBe('https://os.acme.example:8443/os');
    expect(link).toBe(mobileConnectLink('https://os.acme.example:8443/os'));
  });
});

describe('mobileConnectTarget: localhost and private addresses are refused, never encoded', () => {
  it.each([
    'http://localhost:3000',
    'http://app.localhost:3000',
    'http://127.0.0.1:3000',
    'http://10.0.0.5',
    'http://172.16.4.2:8080',
    'http://192.168.1.20/os',
    'http://169.254.10.1',
    'http://100.64.0.1',
    'http://[::1]:3000',
    'http://[fd12::1]',
    'http://intranet',
    'http://os.local',
    'http://os.corp.internal',
  ])('%s', (address) => {
    expect(mobileConnectTarget(address)).toEqual({ kind: 'unreachable', reason: 'not-public', serverUrl: address });
  });

  it('a scheme other than http(s) is refused, and its credential is not shown', () => {
    expect(mobileConnectTarget('ftp://ops:s3cret@os.acme.example')).toEqual({
      kind: 'unreachable',
      reason: 'not-public',
      serverUrl: 'ftp://os.acme.example',
    });
  });
});

describe('mobileConnectTarget: a public host must be HTTPS', () => {
  it('a public host on plain http is refused with the HTTPS remedy, never encoded', () => {
    expect(mobileConnectTarget('http://os.acme.example/os')).toEqual({
      kind: 'unreachable',
      reason: 'not-https',
      serverUrl: 'http://os.acme.example/os',
    });
  });

  it('CONTROL: the same host on https is encoded', () => {
    expect(mobileConnectTarget('https://os.acme.example/os').kind).toBe('ready');
  });
});

describe('mobileConnectTarget: the payload is the normalised address and nothing else', () => {
  it.each([
    ['a username and password', 'https://ops:s3cret@os.acme.example/os', 'https://os.acme.example/os'],
    ['a username alone', 'https://ops@os.acme.example', 'https://os.acme.example'],
    ['a query', 'https://os.acme.example/os?token=abc&tenant=1', 'https://os.acme.example/os'],
    ['a fragment', 'https://os.acme.example/os#session=abc', 'https://os.acme.example/os'],
    ['a trailing slash', 'https://os.acme.example/os/', 'https://os.acme.example/os'],
    ['surrounding whitespace', '  https://os.acme.example  ', 'https://os.acme.example'],
    ['an upper-case scheme and host', 'HTTPS://OS.ACME.Example/os', 'https://os.acme.example/os'],
    ['the default port', 'https://os.acme.example:443/os', 'https://os.acme.example/os'],
  ])('%s is dropped or normalised', (_what, configured, address) => {
    expect(mobileConnectTarget(configured)).toEqual({
      kind: 'ready',
      serverUrl: address,
      connectLink: mobileConnectLink(address),
    });
  });

  it('the decoded server parameter is the only parameter and holds no credential', () => {
    const target = mobileConnectTarget('https://ops:s3cret@os.acme.example/os?token=abc#x');
    const link = new URL((target as { connectLink: string }).connectLink);
    expect([...link.searchParams.keys()]).toEqual(['server']);
    expect(link.searchParams.get('server')).toBe('https://os.acme.example/os');
    expect(link.href).not.toMatch(/s3cret|ops|token|abc/);
  });

  it('a credential on a refused address is not shown either', () => {
    expect(mobileConnectTarget('http://ops:s3cret@192.168.1.20/os')).toEqual({
      kind: 'unreachable',
      reason: 'not-public',
      serverUrl: 'http://192.168.1.20/os',
    });
  });

  it('normalizeServerUrl answers null for a value that is not an absolute URL', () => {
    expect(normalizeServerUrl('os.acme.example')).toBeNull();
    expect(normalizeServerUrl('ops:s3cret@os.acme.example')).toBeNull();
  });
});

describe('mobileConnectTarget: no published URL', () => {
  it.each([undefined, null, '', '   ', 42])('%s reads as unpublished, never as the browser address', (value) => {
    expect(mobileConnectTarget(value)).toEqual({ kind: 'unpublished' });
  });

  it('a value that is not an absolute URL reads as unpublished, so the raw value is never shown', () => {
    expect(mobileConnectTarget('os.acme.example')).toEqual({ kind: 'unpublished' });
    expect(mobileConnectTarget('ops:s3cret@os.acme.example')).toEqual({ kind: 'unpublished' });
  });
});
