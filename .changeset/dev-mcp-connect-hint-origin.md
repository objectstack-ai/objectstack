---
"@objectstack/cli": patch
---

`os dev`'s MCP connect hint is built from the origin the deployment is REACHABLE on, not from the socket the serve child bound.

A dev boot printed two MCP addresses. The ready banner's `➜ MCP:` row goes through `resolveAuthBaseUrl` — `OS_AUTH_URL` → legacy `BETTER_AUTH_URL` → `OS_BASE_URL` → `http://localhost:<port>` — while the `🤖 MCP server — connect a coding agent` block below it derived its base from the child's `objectstack:listening` `url`, which is the bound socket by construction. `OS_AUTH_URL` never entered that expression, so anything sitting in front of the app split the two apart: measured on `objectstack dev -p 4001` under `OS_AUTH_URL=https://localhost:4443` behind a TLS reverse proxy, the banner said `https://localhost:4443/…` and the block said `http://localhost:4001/…` in the same output.

That block's `Connect` line is a command the reader pastes, so the wrong origin was not cosmetic: `claude mcp add` registered an entry against an address discovery never advertises and, behind the proxy, nothing can reach — and the two rows disagreeing made the correct one look like the typo.

- **One resolver, not two.** The hint now calls the same `resolveAuthBaseUrl` the banner's call site does, with the port the child ACTUALLY bound. The precedence chain is not restated anywhere in `dev`.
- **The ordinary local boot is unchanged, by the resolver's own tail.** With none of the three variables set the chain answers `http://localhost:<boundPort>` — including dev's auto-shift (`3000` busy → `3001`) and an ephemeral port — so the local case needs no second fallback and cannot be broken by a canonical origin being hardcoded in front of it.
- **An unusable base URL now prints no block at all.** When the chain yields nothing parseable — a set-but-empty `OS_AUTH_URL=`, which does not fall through to the rest of the chain, or a value with no scheme — the banner's rule is to print paths with no origin and name the variable that fixes it. A `claude mcp add` line has no paths-only form, so the block is omitted instead of reprinting, on the same screen, the exact address the banner just refused to print.

`resolveAuthBaseUrl` itself is untouched, including its set-but-empty behaviour; the `Endpoint` / `Skill` / `Connect` wording is unchanged.
