---
"@objectstack/metadata": minor
---

fix(security): gate the metadata HMR door on an explicit development posture (#12140)

**BREAKING** surface narrowing — `GET`/`POST /api/v1/dev/metadata-events` are no
longer mounted unless `NODE_ENV` is exactly `development`. Shipped as `minor`
under the repo's launch-window convention for breaking changes.

`MetadataPlugin` mounted both HMR routes whenever a raw-app-capable HTTP server
was present, with no authentication and no environment condition of its own. The
dev-only posture the path (`/api/v1/dev/…`) advertises lived only in prose —
"production deployments simply won't have a CLI POSTing to this endpoint" — which
is a claim about who is on the network, not a gate that stops them, and the same
structural shape #9391 closed for the `datasource-admin` family: both mounts take
the host's framework-native app handle, which is outside REST's `enforceAuth`
seam by construction.

The distributions were enumerated rather than assumed, because "a dev-only
surface lacking a gate that says so" and "an unauthenticated door on a real
deployment" want different repairs. The official container image runs `os start`
under `NODE_ENV=production`; that boot reaches `createStandaloneStack`, which
composes `MetadataPlugin` unconditionally (only `artifactWatch` was
NODE_ENV-gated) onto a kernel that registers the Hono server whenever it serves.
So a production-shaped boot did mount both routes and did answer them — `POST`
re-reading the compiled artifact from disk and broadcasting a reload frame to
every connected client, unauthenticated.

`registerMetadataHmrRoutes` now refuses at its first statement, ahead of every
side effect it performs, and returns `null` so "nothing was mounted" is a fact
the compiler forces its caller to handle. Unset `NODE_ENV` is closed, per the
maintainer's 2026-08-06 ruling that an absent value reads as `production`; `test`
and unrecognised spellings (`staging`, `preview`, `qa`) are closed too — a gate
must not treat a spelling nobody recognises as a key.

Who is affected, in both directions:

- `os dev` is unchanged. It spawns `os serve --dev`, which sets
  `NODE_ENV='development'` before any plugin starts, so the watch-recompile loop
  still gets its `200` and Studio still gets its reload frames.
- A deployment that was reaching this endpoint on a production-posture boot now
  gets its host app's `404`. That door was never advertised, never in the SDK
  (`@objectstack/client` builds no such URL) and is a build-tool loopback; if you
  need a supported production reload trigger, that is a product decision, not
  this endpoint.
- The server-side artifact-file watcher is untouched on every boot shape that had
  it: the reload still happens, only the broadcast to (now absent) SSE clients is
  skipped.
