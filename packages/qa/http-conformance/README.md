# @objectstack/http-conformance

**HTTP transport-port conformance gate** — private, never published.
Part of the `packages/qa/` family of verification gates (alongside the
dogfood regression gate and the downstream-contract compatibility gate).

## What this pins

The transport layer is ports-and-adapters (ADR-0076 D11): route consumers —
the dispatcher bridge (`createDispatcherPlugin`) and the REST route
generator (`createRestApiPlugin`) — register against the `IHttpServer` port
(`@objectstack/spec/contracts`), and concrete servers implement it. But only
the Hono adapter ever existed, so "the port is framework-agnostic" was an
unproven claim (ADR-0076 OQ#10, issue #2462).

This package is the proof, kept as a permanent CI gate:

- `src/adapter.ts` — `NodeHttpServer`, a **reference implementation** of the
  port on raw `node:http` with zero dependencies beyond `@objectstack/core`.
  No framework means nothing papers over a port gap: if a consumer needs
  anything Hono-specific, this implementation cannot provide it and the
  suite breaks.
- `src/conformance.integration.test.ts` — boots the real framework stacks
  (dispatcher bridge + REST generator + ObjectQL + memory driver) on **both**
  this adapter and `plugin-hono-server`, over real sockets, and asserts
  identical observable behavior: full `/data` CRUD roundtrip, `/meta` reads,
  `:param` routing, 404/405-with-`Allow` semantics, SSE streaming, discovery,
  plus a probe-for-probe response-shape parity matrix.

If a framework-ism ever leaks into a route consumer, the node half of this
suite is what breaks.

## The port contract, as exercised here

`IHttpServer` proper, plus the two soft extensions consumers feature-detect
(candidates for formalizing into the contract at the D11 window):

- **SSE streaming** — `res.write` / `res.end`, used by AI routes.
- **`getPort()`** — port discovery after `listen(0)`.

Deliberately absent (each a known escape hatch whose consumers
feature-detect and degrade): `getRawApp()` (Hono-specific — metadata HMR,
cloud-connection routes, static/SPA + CORS + Server-Timing), `mount()`,
multipart parsing (binary bodies stay raw behind the lazy `req.rawBody()`).

## Not a product server

`NodeHttpServer` is a validation instrument. Deployments use
`@objectstack/plugin-hono-server`; a user-facing second adapter
(Express/Workers) is a separate product decision for the ADR-0076
cross-repo window — when it lands, plug it into this suite's `ADAPTERS`
array and the same assertions validate it for free.
