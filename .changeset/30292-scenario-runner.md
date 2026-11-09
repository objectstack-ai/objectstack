---
'@objectstack/scenarios': patch
---

feat(scenarios): a local scenario runner builds, runs and iterates every card with a local Claude Code session and writes one run record per card

Clause-②: no
Metadata-protocol: none

- **`pnpm --filter @objectstack/scenarios run-scenarios`** (private, unpublished; entry `@objectstack/scenarios/runner`): for each card under `docs/qa/scenarios/`, scaffold a project with `create-objectstack`, let the agent build it from the card prompt, run `objectstack validate`, `build` and `verify` (opt-in proofs chosen from the card's tags), boot it with `objectstack dev --fresh`, seed the card's rows, create one user, permission-set grant and API key per persona, and run every question and operation over the app's own MCP endpoint as that persona. Then apply the card's iterate change and score again.
- **Template mode**: the card's verified build is installed unmanaged (`POST /api/v1/marketplace/install-local` with `installMode: 'unmanaged'`), the agent applies the iterate change to the installed copy, and the scorecard reports both modes side by side with the size of the change. A refused install is recorded as a finding.
- **Scorecard and run record**: the scorecard reports Build, Run-问数, Run-operations and Iterate per mode, plus a per-tag table, with the real question and operation counts. A degraded build and a leaking answer are flagged. Records use the `docs/qa/platform-checklist/runs/` shape and stay out of git.
- **Card object names are read namespace-relative.** Against a package with namespace `ns`, the card's `account` means `ns_account`. A scaffolded project refuses bare object names, and so does the unmanaged install (`NAMESPACE_PREFIX`).
- **No API-billed model.** The live driver spawns the local `claude` CLI and refuses to start when `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set or the CLI is logged in with an API key. A recorded driver replays turns, so the runner's own tests need no model and no network. All grading is `@objectstack/scenarios/score`.
