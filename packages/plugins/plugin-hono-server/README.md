# @objectstack/plugin-hono-server

HTTP Server adapter for ObjectStack using Hono.

## Features

- **Standard Runtime**: Uses the unified `HttpDispatcher` and standard Hono adapter via `@objectstack/hono`.
- **Fast**: Built on Hono, a high-performance web framework.
- **Full Protocol Support**: Automatically provides all ObjectStack Runtime endpoints (Auth, Data, Metadata, etc.).
- **Middleware**: Supports standard Hono middleware.
- **Wildcard CORS**: Supports wildcard patterns in CORS origins (compatible with better-auth).

## Usage

```typescript
import { ObjectKernel } from '@objectstack/runtime';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';

const kernel = new ObjectKernel();

// Register the server plugin
kernel.use(new HonoServerPlugin({
  port: 3000,
  restConfig: {
      api: {
          apiPath: '/api/v1' // Customize API prefix
      }
  }
}));

await kernel.bootstrap();
```

## CORS Configuration

The Hono server plugin supports flexible CORS configuration with wildcard pattern matching.

### Default: no cross-origin caller

The CORS middleware is mounted by default, and it admits only the origins you name
(`cors.origins`, else `OS_CORS_ORIGIN`). With neither set, **no cross-origin caller is
admitted**. Same-origin requests need no CORS answer, so pages this server serves are
unaffected. On a development boot (`NODE_ENV=development`, which `os dev` sets), loopback
origins (`localhost`, `127.0.0.1`, `[::1]`, any port) are admitted too, beside a list or
without one; on any other boot a list admits only what it names.

`'*'`, or a pattern whose host part is the bare `*` (`https://*`, `*://*`), while
credentials are on (the default) is **refused at init**, so the boot fails. Name the
origins instead, or turn credentials off to serve it to callers that send no cookies:

```typescript
kernel.use(new HonoServerPlugin({
  cors: { origins: '*', credentials: false }
}));
```

The rule is exported as `resolveCorsAdmission`, and `@objectstack/hono`'s `createHonoApp`
reads it too, so one configuration gets one answer at both doors. The matcher it uses,
`createOriginMatcher(patterns, { developmentBoot })`, reads the development boot from
`NODE_ENV` when the option is not passed.

### Basic CORS

```typescript
kernel.use(new HonoServerPlugin({
  port: 3000,
  cors: {
    origins: ['https://app.example.com'],
    credentials: true
  }
}));
```

### Wildcard Patterns (better-auth compatible)

```typescript
// Subdomain wildcards
kernel.use(new HonoServerPlugin({
  cors: {
    origins: ['https://*.objectui.org', 'https://*.objectstack.ai'],
    credentials: true
  }
}));

// Port wildcards (useful for development)
kernel.use(new HonoServerPlugin({
  cors: {
    origins: 'http://localhost:*'
  }
}));

// Comma-separated patterns
kernel.use(new HonoServerPlugin({
  cors: {
    origins: 'https://*.objectui.org,https://*.objectstack.ai,http://localhost:*'
  }
}));
```

### Environment Variables

CORS can also be configured via environment variables:

```bash
# Single origin
OS_CORS_ORIGIN=https://app.example.com

# Wildcard patterns (comma-separated)
OS_CORS_ORIGIN=https://*.objectui.org,https://*.objectstack.ai

# Disable CORS
OS_CORS_ENABLED=false

# Additional options
OS_CORS_CREDENTIALS=true   # default; must be false for OS_CORS_ORIGIN=*
OS_CORS_MAX_AGE=86400
```

The legacy `CORS_*` names are still read.

### Disable CORS

```typescript
kernel.use(new HonoServerPlugin({
  cors: false  // Completely disable CORS
}));
```

### Bearer token auth (`set-auth-token`)

The CORS middleware always includes `set-auth-token` in `Access-Control-Expose-Headers`
so that `@objectstack/plugin-auth`'s `bearer()` plugin can deliver rotated session
tokens to cross-origin and mobile clients. `Authorization` is included in
`Access-Control-Allow-Headers` by default so `Authorization: Bearer <token>`
requests succeed preflight.

You can contribute additional exposed / allowed headers — `exposeHeaders`
entries you supply are **merged** with the `set-auth-token` default:

```typescript
kernel.use(new HonoServerPlugin({
  cors: {
    origins: ['https://app.example.com'],
    credentials: true,
    exposeHeaders: ['X-Request-Id'],           // in addition to set-auth-token
    allowHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id'],
  },
}));
```

## Response compression

The server compresses responses by default. There is nothing to configure. A response
goes out brotli-encoded (`Content-Encoding: br`) or gzip-encoded (`gzip`) when all of
these hold:

- the request's `Accept-Encoding` names `br` or `gzip`. Brotli wins a tie, and `q=0`
  refuses a coding;
- the body is at least 1 KB. A declared `Content-Length` decides this. Without one,
  the server reads the body only until it reaches 1 KB;
- the content type is compressible text (JSON, JavaScript, CSS, HTML, SVG and the like).

That covers API JSON, the Console's JavaScript and CSS bundles, and static files,
whichever route serves them. These responses are never encoded:

- **Streams.** A response written through `res.write()` (SSE, the AI data stream,
  streamed exports), any `text/event-stream`, and a response that sets
  `Transfer-Encoding`. An encoder holds bytes back until it has enough to emit, so an
  encoded stream would reach the client late.
- **Responses that already carry a `Content-Encoding`.** Nothing is encoded twice.
- **`206 Partial Content` and `HEAD`.** A `Range` request on a static file still gets
  the identity bytes its `Content-Range` describes. An encoded answer drops
  `Accept-Ranges`.
- **Responses marked `Cache-Control: no-transform`.**

Every response the server could encode carries `Vary: Accept-Encoding`, whatever the
client sent. The `ETag` is passed through unchanged. Saves send it back as `If-Match`
and the server compares it strongly, so a weakened `W/` tag would fail those saves.

A reverse proxy or CDN in front of the server sees `Content-Encoding` and does not
encode the body again. Code that calls the app in-process (`app.fetch`, `app.request`)
gets an encoded body only if it forwards an `Accept-Encoding` header.

## Architecture

This plugin wraps `@objectstack/hono` to provide a turnkey HTTP server solution for the Runtime. It binds the standard `HttpDispatcher` to a Hono application and starts listening on the configured port.

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
