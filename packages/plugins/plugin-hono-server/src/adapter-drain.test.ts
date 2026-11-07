// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { HonoHttpServer } from './adapter';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
