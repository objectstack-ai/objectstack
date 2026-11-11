// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { connect, type Socket } from 'node:net';
import type { ServerResponse } from 'node:http';
import { describe, it, expect } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { HonoHttpServer } from './adapter';
import { HonoServerPlugin } from './hono-plugin';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A raw HTTP/1.1 connection: what it writes is exactly what the server parses,
 * so a test can split one request's headers across a `close()`, pipeline
 * several requests in one write, or stop reading a response part-way.
 */
async function rawConnection(port: number) {
  const socket: Socket = connect(port, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const chunks: Buffer[] = [];
  socket.on('data', (chunk: Buffer) => chunks.push(chunk));
  socket.on('error', () => { /* a destroyed connection is part of some cases */ });
  const ended = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  return {
    socket,
    ended,
    received: () => Buffer.concat(chunks),
  };
}

/** The head of the first response in `bytes`, its header map, and the body bytes after it. */
function splitResponse(bytes: Buffer) {
  const at = bytes.indexOf('\r\n\r\n');
  if (at < 0) return { head: '', headers: {} as Record<string, string>, body: Buffer.alloc(0) };
  const head = bytes.subarray(0, at).toString('latin1');
  const headers: Record<string, string> = {};
  for (const line of head.split('\r\n').slice(1)) {
    const colon = line.indexOf(':');
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { head, headers, body: bytes.subarray(at + 4) };
}

/** Every response the adapter is still holding for its drain bookkeeping. */
function retainedResponses(server: HonoHttpServer): number {
  const tracked = (server as unknown as { inFlightResponses: Map<unknown, Set<unknown>> }).inFlightResponses;
  let n = 0;
  for (const pending of tracked.values()) n += pending.size;
  return n;
}

/**
 * P1-3 regression: `close()` must DRAIN in-flight requests (let them finish)
 * rather than force-killing them, and must force-close only after the drain
 * window elapses so shutdown can't hang.
 */
describe('HonoHttpServer — graceful close drains in-flight requests (P1-3)', () => {
  it('lets an in-flight request complete instead of aborting it', async () => {
    const server = new HonoHttpServer(0, undefined, 5000); // generous drain window
    server.getRawApp().get('/slow', async (c) => {
      await sleep(200); // still running when close() is called
      return c.text('drained-ok');
    });
    await server.listen(0);
    const port = server.getPort();

    const reqP = fetch(`http://127.0.0.1:${port}/slow`);
    await sleep(50); // ensure the request is being handled
    const closeP = server.close();

    const res = await reqP;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('drained-ok'); // completed, not reset
    // Written after the drain began, so it closes its connection rather than
    // leaving an idle keep-alive socket for `close()` to wait out.
    expect(res.headers.get('connection')).toBe('close');
    await closeP;
  });

  it('a response whose keep-alive headers went out before close() releases its connection when it ends', async () => {
    // The arm `Connection: close` cannot reach: the headers are already on the
    // wire. Before the fix `close()` resolved only when the client dropped the
    // idle socket — about 3 s later for `fetch`, its keep-alive margin under
    // the server's `timeout=5` hint.
    const server = new HonoHttpServer(0, undefined, 5000);
    server.getRawApp().get('/stream', (c) => c.body(new ReadableStream({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode('head-'));
        await sleep(200); // still streaming when close() is called
        controller.enqueue(new TextEncoder().encode('tail'));
        controller.close();
      },
    })));
    await server.listen(0);
    const port = server.getPort();

    const res = await fetch(`http://127.0.0.1:${port}/stream`);
    expect(res.headers.get('connection')).toBe('keep-alive'); // sent before the drain
    const closeP = server.close();

    expect(await res.text()).toBe('head-tail'); // completed, not reset
    const bodyEnded = Date.now();
    await closeP;
    // 1000 ms is a third of the defect's 3 s wait and far above the few
    // milliseconds the release takes, so neither load nor a slow box decides it.
    expect(Date.now() - bodyEnded).toBeLessThan(1000);
  });

  it('a request whose headers finish arriving after close() began is answered Connection: close', async () => {
    // A connection mid-headers when the drain starts is active, so
    // `closeIdleConnections()` leaves it alone, and its response is created
    // only after `close()` has run its loop over the in-flight ones. The
    // request-time branch is what keeps that response from going out
    // keep-alive.
    const server = new HonoHttpServer(0, undefined, 5000);
    server.getRawApp().get('/probe', (c) => c.text('late-arrival'));
    await server.listen(0);
    const conn = await rawConnection(server.getPort());

    conn.socket.write('GET /probe HTTP/1.1\r\nHost: 127.0.0.1\r\n');
    await sleep(50); // the first half has been read: the connection is active
    const closeP = server.close();
    await sleep(20);
    conn.socket.write('Accept: */*\r\n\r\n');

    await conn.ended; // the server ended the connection after the response
    const { head, headers, body } = splitResponse(conn.received());
    expect(head).toMatch(/^HTTP\/1\.1 200/);
    expect(body.toString('utf8')).toBe('late-arrival');
    expect(headers.connection).toBe('close');
    await closeP;
  });

  it('a stream ending during the drain does not cut short another connection\'s response that is still flushing', async () => {
    // Connection B's response calls `end()` during the drain with a body larger
    // than the socket buffers, to a client that is not reading, so it is ended
    // but still flushing. Connection A's stream, whose keep-alive headers went
    // out before `close()`, then ends. Releasing A's connection must not touch
    // B's: Node counts a response as done once it has called `end()`, before
    // its bytes are flushed, so a server-wide `closeIdleConnections()` at that
    // moment destroys B mid-body.
    const BIG = new Uint8Array(32 * 1024 * 1024).fill(0x61);
    let bigResponse: ServerResponse | undefined;
    let releaseBig: () => void = () => {};
    const bigReleased = new Promise<void>((resolve) => { releaseBig = resolve; });
    const server = new HonoHttpServer(0, undefined, 10_000);
    server.getRawApp().get('/big', async (c) => {
      bigResponse = (c.env as { outgoing: ServerResponse }).outgoing;
      await bigReleased; // in flight, not ended, when the drain starts
      return c.body(BIG);
    });
    server.getRawApp().get('/stream', (c) => c.body(new ReadableStream({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode('head-'));
        await sleep(200);
        controller.enqueue(new TextEncoder().encode('tail'));
        controller.close();
      },
    })));
    await server.listen(0);
    const port = server.getPort();

    const slowReader = await rawConnection(port);
    slowReader.socket.pause(); // reads nothing until resumed below
    slowReader.socket.write('GET /big HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
    const stream = await fetch(`http://127.0.0.1:${port}/stream`);
    expect(stream.headers.get('connection')).toBe('keep-alive'); // sent before the drain

    const closeP = server.close();
    releaseBig();
    await sleep(50);
    // The premise: B's response has called end() and is still flushing.
    expect(bigResponse?.writableEnded, 'the big response has called end()').toBe(true);
    expect(bigResponse?.writableFinished, 'the big response is still flushing').toBe(false);

    expect(await stream.text()).toBe('head-tail'); // A ends during the drain
    await sleep(50);
    slowReader.socket.resume();
    await slowReader.ended;
    const { head, headers, body } = splitResponse(slowReader.received());
    expect(head).toMatch(/^HTTP\/1\.1 200/);
    expect(Number(headers['content-length'])).toBe(BIG.length);
    expect(body.length, 'every byte of the body arrived').toBe(BIG.length);
    await closeP;
  });

  it('a response that ended before close() but is still flushing to a slow reader arrives whole', async () => {
    // Node counts a response as done once it has called `end()`, before its
    // bytes are flushed. `server.close()` sweeps idle connections first thing
    // (Node 19 and later), so without the guard this response's connection is
    // destroyed at drain start: 3,919,702 of 33,554,432 bytes arrived on main.
    // An idle keep-alive connection alongside it must still be released by the
    // drain, once the flush is done, rather than holding `close()` open until
    // the server's keep-alive timer fires.
    const BIG = new Uint8Array(32 * 1024 * 1024).fill(0x61);
    let bigResponse: ServerResponse | undefined;
    const server = new HonoHttpServer(0, undefined, 10_000);
    server.getRawApp().get('/big', (c) => {
      bigResponse = (c.env as { outgoing: ServerResponse }).outgoing;
      return c.body(BIG);
    });
    server.getRawApp().get('/probe', (c) => c.text('idle-after-this'));
    await server.listen(0);
    const port = server.getPort();

    const idle = await rawConnection(port);
    idle.socket.write('GET /probe HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
    const slowReader = await rawConnection(port);
    slowReader.socket.pause(); // reads nothing until resumed below
    slowReader.socket.write('GET /big HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
    await sleep(100);
    expect(splitResponse(idle.received()).headers.connection).toBe('keep-alive');
    // The premise: the big response has called end() and is still flushing.
    expect(bigResponse?.writableEnded, 'the big response has called end()').toBe(true);
    expect(bigResponse?.writableFinished, 'the big response is still flushing').toBe(false);

    const closeP = server.close();
    await sleep(50);
    slowReader.socket.resume();
    await slowReader.ended;
    const flushed = Date.now();
    const { head, headers, body } = splitResponse(slowReader.received());
    expect(head).toMatch(/^HTTP\/1\.1 200/);
    expect(Number(headers['content-length'])).toBe(BIG.length);
    expect(body.length, 'every byte of the body arrived').toBe(BIG.length);

    await idle.ended;
    await closeP;
    // The keep-alive timer would hold it 5 s; the release takes milliseconds.
    expect(Date.now() - flushed).toBeLessThan(1000);
  });

  it('an idle keep-alive connection is released at drain start', async () => {
    const server = new HonoHttpServer(0, undefined, 10_000);
    server.getRawApp().get('/probe', (c) => c.text('idle-after-this'));
    await server.listen(0);
    const idle = await rawConnection(server.getPort());
    idle.socket.write('GET /probe HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
    await sleep(50);
    expect(splitResponse(idle.received()).headers.connection).toBe('keep-alive');

    const t0 = Date.now();
    await server.close();
    await idle.ended;
    // Nothing is flushing, so the sweep runs at once: no keep-alive wait.
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('the drain window still force-closes a reader that never drains', async () => {
    const BIG = new Uint8Array(32 * 1024 * 1024).fill(0x61);
    const server = new HonoHttpServer(0, undefined, 300);
    server.getRawApp().get('/big', (c) => c.body(BIG));
    await server.listen(0);
    const stalled = await rawConnection(server.getPort());
    stalled.socket.pause(); // never resumed
    stalled.socket.write('GET /big HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
    await sleep(100);

    const t0 = Date.now();
    await server.close();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(250); // held for the window, not swept at drain start
    expect(elapsed).toBeLessThan(2000); // the 300 ms window, not the reader
    stalled.socket.resume(); // read what made it out, to see the connection end
    await stalled.ended; // the backstop destroyed it
    expect(stalled.received().length).toBeLessThan(BIG.length);
  });

  it('forgets a pipelined response whose connection died before it was written', async () => {
    // Pipelined requests queue behind the first one's response; the queued
    // responses have no socket of their own, so if the connection dies they
    // never emit 'close'. The drain bookkeeping must still let them go, or
    // any client can grow the server's memory by pipelining and hanging up.
    const server = new HonoHttpServer(0, undefined, 5000);
    server.getRawApp().get('/slow', async (c) => {
      await sleep(150);
      return c.text('first');
    });
    server.getRawApp().get('/probe', (c) => c.text('queued'));
    await server.listen(0);
    const conn = await rawConnection(server.getPort());

    const get = (path: string) => `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`;
    conn.socket.write(get('/slow') + get('/probe') + get('/probe') + get('/probe'));
    await sleep(60);
    expect(retainedResponses(server), 'all four responses are tracked while their connection lives').toBe(4);

    conn.socket.destroy();
    await sleep(300); // past the first response's 150 ms, and the server has seen the connection close
    expect(retainedResponses(server)).toBe(0);
    await server.close();
  });

  it('force-closes after the drain window so shutdown cannot hang', async () => {
    const server = new HonoHttpServer(0, undefined, 100); // tiny drain window
    server.getRawApp().get('/hang', async (c) => {
      await sleep(5000); // far longer than the drain window
      return c.text('late');
    });
    await server.listen(0);
    const port = server.getPort();

    const reqP = fetch(`http://127.0.0.1:${port}/hang`).catch((e) => e); // will be aborted
    await sleep(50);

    const t0 = Date.now();
    await server.close();
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(2000); // didn't wait out the 5s request
    await reqP; // the aborted request settled — fine
  });
});

/** A logger that records nothing: the window-end cases below close a socket under a reading handler on purpose. */
const silentLogger = { debug() {}, info() {}, warn() {}, error() {}, fatal() {} } as never;

/** The request line and headers of a `POST /upload` whose JSON body is `body`, sent before any of the body. */
function uploadHead(body: string): string {
  return 'POST /upload HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n'
    + `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
}

/**
 * A request whose body is still arriving when shutdown begins (a slow link, a
 * file, a large import) is answered: served to completion if its body arrives
 * inside the drain window, refused with a 503 and `Connection: close` if it is
 * still arriving when the window ends — never closed with no answer.
 */
describe('HonoHttpServer — a request still uploading when shutdown begins is answered', () => {
  it('through the kernel: shutdown waits for it, and it is served while the services it needs are still up', async () => {
    // `os serve` registers the HTTP plugin before the plugins that serve the
    // routes, and the kernel destroys plugins in reverse order, then exits the
    // process once `shutdown()` resolves. So the drain has to finish before
    // the first `destroy()` runs, and `shutdown()` must not resolve before it.
    const kernel = new ObjectKernel({ gracefulShutdown: false, logger: { level: 'fatal' } });
    const events: string[] = [];
    let serviceUp = true;
    await kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
    await kernel.use({
      name: 'test.route-owner',
      init: async (ctx: any) => {
        ctx.registerService('data', {});
        ctx.hook('kernel:ready', async () => {
          ctx.getService('http.server').getRawApp().post('/upload', async (c: any) => {
            const body = await c.req.text();
            events.push('handler read the body');
            return serviceUp ? c.text(`stored:${body}`) : c.text('service already destroyed', 500);
          });
        });
      },
      destroy: async () => {
        serviceUp = false;
        events.push('route owner destroyed');
      },
    } as never);
    await kernel.bootstrap();
    const port = (kernel.getService('http.server') as HonoHttpServer).getPort();

    const body = JSON.stringify({ email: 'member@example.com', password: 'not-a-real-password' });
    const conn = await rawConnection(port);
    conn.socket.write(uploadHead(body) + body.slice(0, 5));
    await sleep(100); // the request is in: its headers arrived, its body has not
    const shutdown = kernel.shutdown().then(() => { events.push('shutdown resolved'); });
    await sleep(300); // shutdown is under way while the body is still arriving
    conn.socket.write(body.slice(5));

    await conn.ended;
    const { head, headers, body: received } = splitResponse(conn.received());
    expect(head, 'the request was answered').toMatch(/^HTTP\/1\.1 200/);
    expect(received.toString('utf8')).toBe(`stored:${body}`);
    expect(headers.connection).toBe('close');
    await shutdown;
    expect(events).toEqual(['handler read the body', 'route owner destroyed', 'shutdown resolved']);
  });

  it('a body still arriving when the drain window ends is refused with a 503 and Connection: close, then its connection closes', async () => {
    const server = new HonoHttpServer(0, undefined, 300);
    server.setLogger(silentLogger);
    server.getRawApp().post('/upload', async (c) => c.text(`stored:${await c.req.text()}`));
    await server.listen(0);
    const body = JSON.stringify({ file: 'x'.repeat(64) });
    const conn = await rawConnection(server.getPort());
    conn.socket.write(uploadHead(body) + body.slice(0, 5)); // the rest never arrives
    await sleep(100);

    const t0 = Date.now();
    await server.close();
    const elapsed = Date.now() - t0;
    await conn.ended; // the server closed the connection after the refusal

    const { head, headers, body: received } = splitResponse(conn.received());
    expect(head, 'the request was answered, not cut off').toMatch(/^HTTP\/1\.1 503/);
    expect(headers.connection).toBe('close');
    expect(JSON.parse(received.toString('utf8'))).toMatchObject({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
    expect(elapsed).toBeGreaterThanOrEqual(250); // the request had the whole window
    expect(elapsed).toBeLessThan(2000); // the 300 ms window, not the stalled upload
  });

  it('an event stream open when the drain begins does not hold the drain for its window', async () => {
    // An event stream does not end on its own (the Console holds one open
    // during development). The drain releases it at the start, so a restart
    // is not held for the whole window; its client reconnects.
    const server = new HonoHttpServer(0, undefined, 3000);
    server.getRawApp().get('/events', () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': open\n\n'));
      },
    }), { headers: { 'content-type': 'text/event-stream' } }));
    await server.listen(0);
    const conn = await rawConnection(server.getPort());
    conn.socket.write('GET /events HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
    await sleep(100);
    expect(splitResponse(conn.received()).head, 'the stream is open').toMatch(/^HTTP\/1\.1 200/);

    const t0 = Date.now();
    await server.close();
    await conn.ended;
    expect(Date.now() - t0).toBeLessThan(1000); // released at drain start, not at the 3 s window
  });
});
