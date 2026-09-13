---
'@objectstack/cli': minor
'@objectstack/plugin-hono-server': minor
---

feat(cli): `objectstack dev --cert <path> --key <path>` terminates TLS in the dev process, and the canonical origin follows the listener (#16804)

An interactive MCP client refuses to start an OAuth sign-in against a non-TLS
URL, so the self-serve identity path the product advertises — "interactive
clients just open a browser login" — could not be exercised against a local dev
server at all. The only way round it was a hand-built https reverse proxy plus
`OS_AUTH_URL`, a page of setup that every developer, demo and video recording
repeated off-camera.

**Bring your own certificate.** Nothing here generates one, and nothing here —
not the code, not `--help`, not any doc page — says anything about installing a
certificate into a system trust store. 「⛔ 不生成自签 CA；⛔ 不打印、不文档化任何
「把 CA 装进系统信任库」的指引——信任库是开发者自己的事」. The trust store is the
developer's own business; this feature's whole job is to *use* the certificate
they already have.

```bash
objectstack dev --cert ./localhost.pem --key ./localhost-key.pem
```

Both flags are required together — half a pair is refused by name — and an
unreadable file is refused rather than degraded to a plain-http listener.

**What follows the listener.** With both flags given, everything this boot
advertises is `https://localhost:<port>`: the two `/.well-known/*` discovery
documents, the CSRF allow-list, the ready banner's `API:` / `MCP:` rows, the
`🤖 MCP server` connect hint, and the runtime state file the `os dev` parent and
external supervisors dial. Only the built-in default at the end of the base-URL
chain moves — `OS_AUTH_URL`, `BETTER_AUTH_URL` and `OS_BASE_URL` keep winning,
an `http://` value included, because they name where a deployment is *reached*
rather than what this process *bound*.

**Without the flags nothing changes**, byte for byte — pinned by ablation legs
rather than asserted.

`@objectstack/plugin-hono-server` gains the option this is built on:
`HonoPluginOptions.tls` (`{ cert, key }` PEM bytes) makes the adapter bind a TLS
listener with the same fetch handler, the same route table and the same graceful
drain. Absent, the listener is plain http exactly as before.
