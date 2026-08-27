---
"@objectstack/cli": minor
---

feat(cli): `os serve` announces a shifted port, naming the one you asked for and the one it took (#12543)

In development (`os dev`, `--dev`, or `NODE_ENV=development`) `os serve` hops to
the next free port when the requested one is taken, so several example apps can
run side by side. That behaviour is unchanged and deliberate — production still
refuses to drift (#11113). What changed is that the hop is no longer silent.

Previously the only trace of a shift was the ready banner printing the port that
was *bound*; nothing said it was not the port that was *asked for*, so every
reader had to already know the requested port and compare the two by hand. A
boot that shifts now prints, before anything else:

```
  ⚠ Port 32869 is in use — serving on 32871 instead.
     Development auto-shift: 32869 was not free, so this server took
     the next one that was (32871). Anything still pointed at 32869 — a
     proxy, an OAuth callback URL, another terminal, a test harness — is
     talking to whatever holds 32869, not to this server.
```

The notice is written to **stderr**, like every other `os serve` diagnostic:
`stdout` carries JSON-RPC frames whenever the stdio MCP transport is mounted, so
nothing but protocol may go there. It prints only when the bound port actually
differs from the requested one — an ordinary boot on a free port is unchanged,
byte for byte.
