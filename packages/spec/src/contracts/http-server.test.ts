import { describe, it, expect } from 'vitest';
import type {
  IHttpRequest,
  IHttpResponse,
  RouteHandler,
  Middleware,
  IHttpServer,
  HttpResponseObservation,
  HttpResponseObserver,
} from './http-server';
import { UNMATCHED_ROUTE_PATTERN } from './http-server';

describe('HTTP Server Contract', () => {
  describe('IHttpRequest interface', () => {
    it('should allow a valid request object', () => {
      const req: IHttpRequest = {
        params: { id: '123' },
        query: { page: '1', tags: ['a', 'b'] },
        body: { name: 'Test' },
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        path: '/api/users',
      };

      expect(req.params.id).toBe('123');
      expect(req.method).toBe('POST');
      expect(req.path).toBe('/api/users');
      expect(req.body).toEqual({ name: 'Test' });
    });

    it('should allow a minimal request without body', () => {
      const req: IHttpRequest = {
        params: {},
        query: {},
        headers: {},
        method: 'GET',
        path: '/',
      };

      expect(req.body).toBeUndefined();
      expect(req.method).toBe('GET');
    });
  });

  describe('IHttpResponse interface', () => {
    it('should support chaining status and header calls', () => {
      const res: IHttpResponse = {
        json: (_data) => {},
        send: (_data) => {},
        status: function (code) {
          return this;
        },
        header: function (name, value) {
          return this;
        },
      };

      // Chaining: res.status(200).header('X-Custom', 'val').json({})
      const chained = res.status(200).header('X-Custom', 'value');
      expect(chained).toBeDefined();
    });

    it('should call json and send', () => {
      const sent: any[] = [];
      const res: IHttpResponse = {
        json: (data) => { sent.push({ type: 'json', data }); },
        send: (data) => { sent.push({ type: 'text', data }); },
        status: function () { return this; },
        header: function () { return this; },
      };

      res.json({ message: 'ok' });
      res.send('<h1>Hello</h1>');

      expect(sent).toHaveLength(2);
      expect(sent[0]).toEqual({ type: 'json', data: { message: 'ok' } });
      expect(sent[1]).toEqual({ type: 'text', data: '<h1>Hello</h1>' });
    });
  });

  describe('RouteHandler type', () => {
    it('should accept a sync route handler', () => {
      const handler: RouteHandler = (_req, res) => {
        res.status(200).json({ ok: true });
      };

      expect(typeof handler).toBe('function');
    });

    it('should accept an async route handler', () => {
      const handler: RouteHandler = async (_req, res) => {
        res.status(200).json({ ok: true });
      };

      expect(typeof handler).toBe('function');
    });
  });

  describe('Middleware type', () => {
    it('should accept a sync middleware', () => {
      const mw: Middleware = (_req, _res, next) => {
        next();
      };

      expect(typeof mw).toBe('function');
    });

    it('should accept an async middleware', () => {
      const mw: Middleware = async (_req, _res, next) => {
        await next();
      };

      expect(typeof mw).toBe('function');
    });
  });

  describe('IHttpServer interface', () => {
    it('should allow a full implementation', () => {
      const routes: Array<{ method: string; path: string }> = [];

      const server: IHttpServer = {
        get: (path, _handler) => { routes.push({ method: 'GET', path }); },
        post: (path, _handler) => { routes.push({ method: 'POST', path }); },
        put: (path, _handler) => { routes.push({ method: 'PUT', path }); },
        delete: (path, _handler) => { routes.push({ method: 'DELETE', path }); },
        patch: (path, _handler) => { routes.push({ method: 'PATCH', path }); },
        use: (_pathOrHandler, _handler?) => {},
        listen: async (_port) => {},
      };

      server.get('/api/users', async (_req, res) => res.json([]));
      server.post('/api/users', async (_req, res) => res.status(201).json({}));
      server.put('/api/users/:id', async (_req, res) => res.json({}));
      server.delete('/api/users/:id', async (_req, res) => res.status(204).send(''));
      server.patch('/api/users/:id', async (_req, res) => res.json({}));

      expect(routes).toHaveLength(5);
      expect(routes.map(r => r.method)).toEqual(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);
    });

    it('should support middleware registration', () => {
      const middlewareApplied: string[] = [];

      const server: IHttpServer = {
        get: () => {},
        post: () => {},
        put: () => {},
        delete: () => {},
        patch: () => {},
        use: (pathOrHandler, _handler?) => {
          if (typeof pathOrHandler === 'string') {
            middlewareApplied.push(`path:${pathOrHandler}`);
          } else {
            middlewareApplied.push('global');
          }
        },
        listen: async () => {},
      };

      const globalMw: Middleware = (_req, _res, next) => { next(); };
      server.use(globalMw);
      server.use('/api', globalMw);

      expect(middlewareApplied).toEqual(['global', 'path:/api']);
    });

    it('should support optional close method', async () => {
      const server: IHttpServer = {
        get: () => {},
        post: () => {},
        put: () => {},
        delete: () => {},
        patch: () => {},
        use: () => {},
        listen: async () => {},
        close: async () => {},
      };

      expect(server.close).toBeDefined();
      await expect(server.close!()).resolves.toBeUndefined();
    });

    describe('optional setFallbackHandler (#5040 E1)', () => {
      /** A server with only the REQUIRED members. */
      const baseServer = (): IHttpServer => ({
        get: () => {},
        post: () => {},
        put: () => {},
        delete: () => {},
        patch: () => {},
        use: () => {},
        listen: async () => {},
      });

      it('is optional — an adapter without it still satisfies the contract', () => {
        const server = baseServer();

        expect(typeof server.setFallbackHandler).toBe('undefined');
        expect(typeof server.setFallbackHandler === 'function').toBe(false);
      });

      it('is feature-detected with typeof === "function" when provided', () => {
        const server: IHttpServer = {
          ...baseServer(),
          setFallbackHandler: (_handler) => {},
        };

        expect(typeof server.setFallbackHandler).toBe('function');
      });

      it('accepts a RouteHandler — the same handler shape routes take', () => {
        let installed: RouteHandler | undefined;

        const server: IHttpServer = {
          ...baseServer(),
          setFallbackHandler: (handler) => { installed = handler; },
        };

        const fallback: RouteHandler = async (_req, res) => {
          res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND' } });
        };
        server.setFallbackHandler!(fallback);

        expect(installed).toBe(fallback);
      });

      it('runs only after every registered route misses', async () => {
        const registered = new Set<string>();
        let fallback: RouteHandler | undefined;

        const server: IHttpServer = {
          ...baseServer(),
          get: (path) => { registered.add(`GET ${path}`); },
          setFallbackHandler: (handler) => { fallback = handler; },
        };

        server.get('/api/v1/data/showcase_task', async (_req, res) => res.json([]));

        const answered: string[] = [];
        server.setFallbackHandler!(async (req, res) => {
          answered.push(`${req.method} ${req.path}`);
          res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND' } });
        });

        const dispatch = async (method: string, path: string) => {
          const res: IHttpResponse = {
            json: () => {}, send: () => {},
            status: function () { return this; },
            header: function () { return this; },
          };
          if (registered.has(`${method} ${path}`)) return 'route';
          await fallback!(
            { params: {}, query: {}, headers: {}, method, path, body: { note: 'readable' } },
            res,
          );
          return 'fallback';
        };

        // A registered route is never shadowed by the fallback.
        expect(await dispatch('GET', '/api/v1/data/showcase_task')).toBe('route');
        expect(answered).toEqual([]);

        // Only the unmatched request reaches it.
        expect(await dispatch('GET', '/api/v1/apps/showcase/tasks')).toBe('fallback');
        expect(answered).toEqual(['GET /api/v1/apps/showcase/tasks']);
      });

      it('receives a request whose body is readable (unlike the use() middleware seam)', async () => {
        let seenBody: unknown;

        const fallback: RouteHandler = async (req, res) => {
          seenBody = req.body;
          res.status(200).json({ ok: true });
        };

        const res: IHttpResponse = {
          json: () => {}, send: () => {},
          status: function () { return this; },
          header: function () { return this; },
        };

        await fallback(
          {
            params: {},
            query: {},
            headers: { 'content-type': 'application/json' },
            method: 'POST',
            path: '/api/v1/apps/showcase/inquiries/purge',
            body: { olderThanDays: 30 },
          },
          res,
        );

        expect(seenBody).toEqual({ olderThanDays: 30 });
      });

      it('installing twice replaces the handler — there is one fallback, not a chain', () => {
        let current: RouteHandler | undefined;

        const server: IHttpServer = {
          ...baseServer(),
          setFallbackHandler: (handler) => { current = handler; },
        };

        const first: RouteHandler = () => {};
        const second: RouteHandler = () => {};

        server.setFallbackHandler!(first);
        expect(current).toBe(first);

        server.setFallbackHandler!(second);
        expect(current).toBe(second);
      });
    });

    describe('optional afterResponse (#9835)', () => {
      /** A server with only the REQUIRED members. */
      const baseServer = (): IHttpServer => ({
        get: () => {},
        post: () => {},
        put: () => {},
        delete: () => {},
        patch: () => {},
        use: () => {},
        listen: async () => {},
      });

      it('is optional — an adapter without it still satisfies the contract', () => {
        const server = baseServer();

        expect(typeof server.afterResponse).toBe('undefined');
        // The documented consequence: this transport reports NO HTTP metrics.
        // Zero on `http_requests_total` there means "not instrumented",
        // never "no traffic" — a consumer must ask, exactly like this:
        expect(typeof server.afterResponse === 'function').toBe(false);
      });

      it('is feature-detected with typeof === "function" when provided (runtime-real, not type-only)', () => {
        const server: IHttpServer = {
          ...baseServer(),
          afterResponse: (_observer) => {},
        };

        expect(typeof server.afterResponse).toBe('function');
      });

      it('a delegating wrapper that forwards only required members ERASES detection (#5122 shape)', () => {
        const underlying: IHttpServer = {
          ...baseServer(),
          afterResponse: (_observer) => {},
        };
        // The failure mode the contract warns wrappers against: forward the
        // required members, drop the optional ones.
        const erasingWrapper: IHttpServer = {
          get: underlying.get,
          post: underlying.post,
          put: underlying.put,
          delete: underlying.delete,
          patch: underlying.patch,
          use: underlying.use,
          listen: underlying.listen,
        };
        // The underlying adapter implements the hook; the wrapper makes the
        // contract's own detection idiom read "not instrumented".
        expect(typeof underlying.afterResponse === 'function').toBe(true);
        expect(typeof erasingWrapper.afterResponse === 'function').toBe(false);
        // The compliant wrapper forwards conditionally — present iff wrapped.
        const forwardingWrapper: IHttpServer = {
          ...erasingWrapper,
          ...(typeof underlying.afterResponse === 'function'
            ? { afterResponse: underlying.afterResponse.bind(underlying) }
            : {}),
        };
        expect(typeof forwardingWrapper.afterResponse === 'function').toBe(true);
      });

      it('registration APPENDS — several observers coexist, unlike setFallbackHandler', () => {
        const observers: HttpResponseObserver[] = [];
        const server: IHttpServer = {
          ...baseServer(),
          afterResponse: (observer) => { observers.push(observer); },
        };

        const metricsObserver: HttpResponseObserver = () => {};
        const accessLogObserver: HttpResponseObserver = () => {};
        server.afterResponse!(metricsObserver);
        server.afterResponse!(accessLogObserver);

        // Both registered, registration order kept — nothing replaced.
        expect(observers).toEqual([metricsObserver, accessLogObserver]);
      });

      it('carries the observation shape: method, routePattern (the PATTERN), status, elapsedMs', () => {
        const seen: HttpResponseObservation[] = [];
        const observer: HttpResponseObserver = (observation) => { seen.push(observation); };

        // What a compliant adapter reports for GET /api/v1/data/rec_42
        // answered by the registered route `/api/v1/data/:id`: the PATTERN,
        // never the concrete path — the hard requirement the contract states
        // so no adapter re-decides cardinality.
        observer({
          method: 'GET',
          routePattern: '/api/v1/data/:id',
          status: 200,
          elapsedMs: 3,
        });

        expect(seen).toHaveLength(1);
        expect(seen[0].routePattern).toBe('/api/v1/data/:id');
        expect(seen[0].routePattern).not.toContain('rec_42');
        expect(seen[0].status).toBe(200);
        expect(typeof seen[0].elapsedMs).toBe('number');
      });

      it('reports a request no route matched with the reserved UNMATCHED_ROUTE_PATTERN', () => {
        // Reserved in the CONTRACT, not per adapter, so every transport
        // reports the same spelling and unrouted traffic is one series.
        expect(UNMATCHED_ROUTE_PATTERN).toBe('unmatched');

        const seen: HttpResponseObservation[] = [];
        const observer: HttpResponseObserver = (observation) => { seen.push(observation); };
        observer({
          method: 'GET',
          routePattern: UNMATCHED_ROUTE_PATTERN,
          status: 404,
          elapsedMs: 1,
        });
        expect(seen[0].routePattern).toBe('unmatched');
      });

      it('a throwing observer must not affect the response or sibling observers — the delivery contract, modelled', () => {
        const observers: HttpResponseObserver[] = [];
        const server: IHttpServer = {
          ...baseServer(),
          afterResponse: (observer) => { observers.push(observer); },
        };

        const delivered: string[] = [];
        server.afterResponse!(() => { throw new Error('broken metrics backend'); });
        server.afterResponse!(() => { delivered.push('access-log'); });

        // How a compliant adapter delivers: each observer isolated, failures
        // swallowed — a metrics backend must never break a response.
        const deliver = (observation: HttpResponseObservation) => {
          for (const observer of observers) {
            try {
              observer(observation);
            } catch {
              /* observer failures never propagate */
            }
          }
        };
        expect(() =>
          deliver({ method: 'GET', routePattern: '/x', status: 200, elapsedMs: 0 }),
        ).not.toThrow();
        expect(delivered).toEqual(['access-log']);
      });
    });

    it('should listen on a port', async () => {
      let listenedPort: number | undefined;

      const server: IHttpServer = {
        get: () => {},
        post: () => {},
        put: () => {},
        delete: () => {},
        patch: () => {},
        use: () => {},
        listen: async (port) => { listenedPort = port; },
      };

      await server.listen(3000);
      expect(listenedPort).toBe(3000);
    });
  });
});
