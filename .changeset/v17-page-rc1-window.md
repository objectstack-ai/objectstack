---
---

Docs-only: carry the v17 release page across the `rc.0 → rc.1` window. Releases
nothing.

The page stopped at the rc.0 cut while 334 changesets (40 `major`-class) and
five objectui pin moves landed on `main` — the layer-3 curated page
`docs/releases-maintenance.md` makes mandatory for a major, left a release
behind the train it documents.

Adds a **Landed since 17.0.0-rc.0** section organised by who has to act on it:
the metadata and protocol changes an upgrading application developer must read
(the `/actions` HTTP contract, list queries that apply-or-fail, the one alias
fold across every engine method, `query.having` becoming real, flow-node config
enforcement, stored-metadata conversion replay, the temporal campaign,
ADR-0111 sharing authority), then the platform capabilities an administrator
gains (honest 501s naming the package to install, `os migrate` writing nothing
before confirmation, boot-log visibility, platform-objects infrastructure,
cron jobs that finally fire), then a security-corrections subsection for the
four fail-opens closed in this window, then the Console delta.

The largest post-rc.0 landings (ADR-0110, ADR-0104 D2, ADR-0113, ADR-0114, the
#4001 strictness clicks, the seven protocol-17 retirements, the #4212 family,
the #3896 sweep) were already written into the sections above as they landed;
the new section names them and points there rather than restating them, so the
page cannot grow two accounts of one change that drift apart.

Also extends the upgrade checklist with this window's consumer-facing actions
and the References list with its ADRs and PRs, and scopes the existing Console
section to the rc.0 window it actually documents.
