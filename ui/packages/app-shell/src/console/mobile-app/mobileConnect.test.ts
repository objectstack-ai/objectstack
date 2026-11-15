// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Mobile App page's connect payload is built from the server's published
 * public base URL, sub-path mount included, and a loopback or private address
 * is refused instead of encoded (objectstack#29314).
 */

import { describe, expect, it } from 'vitest';
import { mobileConnectLink, mobileConnectTarget } from './mobileConnect';

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
    expect(mobileConnectTarget(address)).toEqual({ kind: 'unreachable', serverUrl: address });
  });

  it('a value that is not an absolute http(s) URL is refused too', () => {
    expect(mobileConnectTarget('os.acme.example').kind).toBe('unreachable');
    expect(mobileConnectTarget('ftp://os.acme.example').kind).toBe('unreachable');
  });

  it('CONTROL: a public host on plain http is not a private address, so it is encoded', () => {
    expect(mobileConnectTarget('http://os.acme.example').kind).toBe('ready');
  });
});

describe('mobileConnectTarget: no published URL', () => {
  it.each([undefined, null, '', '   ', 42])('%s reads as unpublished, never as the browser address', (value) => {
    expect(mobileConnectTarget(value)).toEqual({ kind: 'unpublished' });
  });
});
