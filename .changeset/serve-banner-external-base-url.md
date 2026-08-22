---
"@objectstack/cli": patch
---

**Bug fix (wrong address printed):** the `os serve` / `os dev` ready banner now builds its API, Console and MCP links from the origin an operator can actually reach, instead of composing `http://localhost:<port>` from the port the process happens to bind (#10646).

Measured on the EE 4.1.0 published-image compose stack (moved from cloud#1507). The app container `expose`s `:3000` with no `ports:` mapping — unreachable from the host, and less so still under `--scale app=N` — while the published entry point is Caddy on `:80`, and compose has already resolved `OS_AUTH_URL` to `http://localhost`. The banner printed the container-internal address anyway:

```
  ➜  API:       http://localhost:3000/
  ➜  Console:   http://localhost:3000/_console/
  ➜  MCP:       http://localhost:3000/api/v1/mcp
      connect an AI client (Claude Code, Cursor, …) · skill: http://localhost:3000/api/v1/mcp/skill
```

Following the Console link failed outright; after moving the deployment to a domain the banner still said `localhost:3000`; and the `MCP:` line is the address customers paste into an AI client, where a wrong absolute URL never fails loudly — it just never connects.

**The origin is the runtime own answer, not a second one.** The banner resolves it through `resolveAuthBaseUrl` — the same function whose `baseOrigin` is pushed onto the CSRF allow-list a few hundred lines earlier in the same boot — so the banner and the origin the deployment actually trusts cannot drift apart. That chain is `OS_AUTH_URL` → legacy `BETTER_AUTH_URL` → `OS_BASE_URL` → `http://localhost:<port>`; the legacy name sits in the middle and is easy to miss when the chain is restated from memory, which is one reason it is read rather than restated. Nothing about what the server listens on, binds to, or advertises to a client changed: the resolver reads `process.env` and the bound port, and this fix changes only printed text.

**When no origin can be determined, the banner prints no absolute URL at all.** The chain yields nothing usable when a variable is set-but-empty (`OS_AUTH_URL=` stops the chain rather than falling through) or carries no scheme. The banner then prints the paths bare —

```
  ➜  API:       /
  ➜  Console:   /_console/
  ➜  MCP:       /api/v1/mcp
      connect an AI client (Claude Code, Cursor, …) · skill: /api/v1/mcp/skill
      paths only — this deployment external base URL could not be resolved;
      set OS_AUTH_URL to its public origin (e.g. https://app.example.com)
```

— because a missing address sends the operator to look one up, while a confident wrong one gets copied. `http://localhost:3000` was never a neutral default here; it was the wrong answer that shipped.

The local dev loop is unchanged: with nothing set, the tail of the chain is still `http://localhost:<port>` on the port that was actually bound (past any dev auto-shift), so `os dev` keeps its clickable Console link.

Structurally, `ServerReadyOptions.port` is replaced by a required `externalBaseOrigin: string | null`. The banner no longer knows the port, so it cannot compose an address from one, and a caller that fails to resolve an origin is a compile error rather than a plausible-looking line of output.
