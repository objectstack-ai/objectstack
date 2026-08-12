---
"@objectstack/cli": patch
---

fix(cli): `os dev` refuses to serve a console built from a different objectui SHA than the pin (#7752)

`packages/console/dist` is a gitignored local build that only
`scripts/build-console.sh` (`pnpm objectui:build`) refreshes — `turbo run
build` never touches it. Pull a branch that moves `.objectui-sha` and the pin
advances while the dist stays frozen, so the server keeps serving a Console
SPA the repo no longer pins.

`pnpm check:console-sha` already fails on exactly this, but it is wired into
the root `pnpm dev` / `dev:showcase` / `dev:crm` / `dev:todo` scripts only.
Every other way to boot reaches the server without passing it — `objectstack
dev` run inside an example dir, an example's own `dev` script (`objectstack
dev --seed-admin`), a `.claude/launch.json` config driving `pnpm exec
objectstack dev`. A QA sweep booted that way and spent its run measuring a
console two days behind the pin; two of its clauses had to be recorded
`blocked` once the gap was found.

So the guard gets a second seat on the boot path itself. When the dist carries
an objectui stamp that provably differs from the repo's pin, `os dev` now
declines to mount `/_console` and prints the rebuild remediation, instead of
serving the stale bundle under a warning that scrolls past. The API still
boots, so api/cli work is unaffected, and the banner stops advertising a
console URL that would have been a lie.

Deliberately narrow: dev only, and only on drift it can prove. A published
install ships no `.objectui-sha` pin and the sibling-repo dev fallback writes
no stamp — both keep resolving exactly as before, and no production or cloud
deployment can reach the refusal. `OS_ALLOW_CONSOLE_DRIFT=1` boots the stale
bundle anyway when that is what you want.
