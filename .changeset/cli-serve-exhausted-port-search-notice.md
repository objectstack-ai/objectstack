---
"@objectstack/cli": minor
---

feat(cli): `os serve` says so when its port search runs out of ports, in the words the search threw (#12620)

In development (`os dev`, `--dev`, or `NODE_ENV=development`) `os serve` walks
forward from the requested port looking for a free one. That walk gives up after
101 ports, and when it does it throws a message naming the problem exactly —
which the caller then discarded, fell through, and bound the requested port
anyway: the one port the search had *just proven* was taken.

That boot died on the kernel's raw `EADDRINUSE` with no explanation anywhere. It
is the one shape in the whole port policy that reached **neither** half of this
family's legibility work: the production `Port … is already in use` line lives in
a branch this boot never enters, and the shifted-port notice (#12543) is printed
only when the bound port differs from the requested one — on this path they are
the same, because the search threw before it could assign. The accurate sentence
existed and was thrown away one line earlier.

The fallthrough is unchanged and still deliberate — a developer whose whole next
span is busy arguably does want the requested port attempted rather than a hard
refusal, and whether it should refuse instead is a separate policy question
(#11113). What changed is that it is no longer silent:

```
  ⚠ Could not find an available port starting from 32869
     Development auto-shift probed 101 ports (32869–32969) and every
     one was busy, so this server is falling back to 32869 — the port the
     search has just proven is taken. The bind that follows will almost
     certainly fail with a raw EADDRINUSE from the kernel, and this notice
     is the only place that says why.
     Free a port in 32869–32969, or pick another via PORT=<port> (or --port <port>).
```

The first line is the search's own thrown message, carried rather than
paraphrased, so there is one spelling of that fact and not two that can drift
apart. The width it reports is read from the same constant the walk uses, so the
range it names is always the range it actually probed.

Written to **stderr**, like every other `os serve` diagnostic: `stdout` carries
JSON-RPC frames whenever the stdio MCP transport is mounted, so nothing but
protocol may go there. It prints only when the search is exhausted — an ordinary
auto-shift and a production boot are both unchanged, byte for byte.
