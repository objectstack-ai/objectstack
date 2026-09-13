// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework#16804 — the adapter binds a TLS listener when it is handed
 * certificate material, and an ORDINARY one when it is not.
 *
 * ## Why this drives a real socket
 *
 * The whole question is what kind of server got created. `@hono/node-server`
 * takes the factory as an option, so the diff is one branch — and a branch is
 * exactly the shape a source-scanning test blesses without ever binding
 * anything. So every case below listens on a real ephemeral port and speaks to
 * it, and the two legs are driven against each other: the https leg must refuse
 * a plain-http request and the http leg must refuse a TLS one. Either leg alone
 * could pass by the server being broken in a way that happens to fail.
 *
 * ## The certificate is the TEST's, and it stays the test's
 *
 * It is minted here with `node:crypto` into a tempdir and deleted afterwards.
 * ⛔ That is not a product capability and must not become one: the maintainer's
 * ruling refused certificate generation in the shipped CLI on a
 * security-statement ground. A test minting its own fixture makes no statement
 * to anyone — nothing is printed, nothing is installed, and nothing outside
 * this file can reach it.
 */

import { X509Certificate, createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpsRequest } from 'node:https';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HonoHttpServer } from './adapter';

let scratch: string;
let cert: string;
let key: string;
/** Set when this box cannot mint a certificate; every case then refuses loudly. */
let mintFailure: string | null = null;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'os-hono-tls-'));
  try {
    // `openssl req -x509` is the one spelling available without a dependency:
    // Node's crypto can generate the key pair but cannot self-sign an X.509
    // certificate. The key pair below is generated only to prove the toolchain
    // is live before the shell call, so a failure is attributable.
    generateKeyPairSync('rsa', { modulusLength: 2048 });
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(scratch, 'key.pem'),
      '-out', join(scratch, 'cert.pem'),
      '-days', '1', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ], { stdio: 'pipe' });
    cert = readFileSync(join(scratch, 'cert.pem'), 'utf8');
    key = readFileSync(join(scratch, 'key.pem'), 'utf8');
  } catch (e) {
    mintFailure = e instanceof Error ? e.message : String(e);
  }
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface TlsResponse { status: number; body: string }

/**
 * A GET over TLS that trusts THIS test's certificate and nothing else.
 *
 * ⛔ Not `NODE_TLS_REJECT_UNAUTHORIZED=0`, which disables verification for the
 * whole process — including every sibling test sharing the worker — and would
 * let the https leg pass against a certificate it never actually presented.
 * Node's global `fetch` has no per-request `ca`, so this is `node:https` rather
 * than a new dependency.
 */
const trustingGet = (port: number, path: string): Promise<TlsResponse> =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(
      { host: 'localhost', port, path, method: 'GET', ca: cert, servername: 'localhost' },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });

describe('HonoHttpServer — a TLS listener from caller-supplied material (#16804)', () => {
  it('the fixture minted, so a zero below is a reading rather than a dead probe', () => {
    expect(mintFailure, `could not mint the test certificate: ${mintFailure}`).toBeNull();
    // And it really is a certificate for localhost — the negative cases below
    // rest on the handshake failing for the RIGHT reason.
    const x509 = new X509Certificate(cert);
    expect(x509.subject).toContain('localhost');
    expect(() => createPrivateKey(key)).not.toThrow();
  });

  it('speaks https, and the same fetch handler answers', async () => {
    const server = new HonoHttpServer(0, undefined, 1000, { cert, key });
    server.getRawApp().get('/probe', (c) => c.json({ served: 'over-tls' }));
    await server.listen(0);
    const port = server.getPort();
    try {
      expect(server.getProtocol()).toBe('https');

      const res = await trustingGet(port, '/probe');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ served: 'over-tls' });
    } finally {
      await server.close();
    }
  });

  it('⛔ and REFUSES a plain-http request on that same port', async () => {
    // The discriminating half. Without it, a listener that quietly stayed
    // plain-http would pass the case above through an https URL that Node
    // happened to downgrade.
    const server = new HonoHttpServer(0, undefined, 1000, { cert, key });
    server.getRawApp().get('/probe', (c) => c.text('unreachable-over-http'));
    await server.listen(0);
    const port = server.getPort();
    try {
      await expect(fetch(`http://127.0.0.1:${port}/probe`)).rejects.toThrow();
    } finally {
      await server.close();
    }
  });

  it('ABLATION: without the material the SAME server is plain http', async () => {
    // The leg that pins "nothing changes when the option is absent": identical
    // construction but for the fourth argument, and the two legs disagree in
    // both directions.
    const server = new HonoHttpServer(0, undefined, 1000);
    server.getRawApp().get('/probe', (c) => c.json({ served: 'over-http' }));
    await server.listen(0);
    const port = server.getPort();
    try {
      expect(server.getProtocol()).toBe('http');

      const res = await fetch(`http://127.0.0.1:${port}/probe`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ served: 'over-http' });

      // …and it is not secretly a TLS listener either.
      await expect(trustingGet(port, '/probe')).rejects.toThrow();
    } finally {
      await server.close();
    }
  });

  it('drains on close exactly as the plain listener does', async () => {
    // TLS must not cost the graceful-drain contract (`adapter-drain.test.ts`
    // owns it for the http listener); the two share every line but the factory.
    const server = new HonoHttpServer(0, undefined, 5000, { cert, key });
    server.getRawApp().get('/slow', async (c) => {
      await new Promise((r) => setTimeout(r, 200));
      return c.text('drained-ok');
    });
    await server.listen(0);
    const port = server.getPort();

    const inFlight = trustingGet(port, '/slow');
    await new Promise((r) => setTimeout(r, 50));
    const closing = server.close();

    const res = await inFlight;
    expect(res.status).toBe(200);
    expect(res.body).toBe('drained-ok');
    await closing;
  });

  it('the port walk still applies — a busy port shifts, over TLS too', async () => {
    const first = new HonoHttpServer(0, undefined, 1000, { cert, key });
    first.getRawApp().get('/probe', (c) => c.text('first'));
    await first.listen(0);
    const taken = first.getPort();
    try {
      const second = new HonoHttpServer(taken, undefined, 1000, { cert, key });
      second.getRawApp().get('/probe', (c) => c.text('second'));
      await second.listen(taken);
      try {
        expect(second.getPort()).not.toBe(taken);
        const res = await trustingGet(second.getPort(), '/probe');
        expect(res.body).toBe('second');
      } finally {
        await second.close();
      }
    } finally {
      await first.close();
    }
  });
});
