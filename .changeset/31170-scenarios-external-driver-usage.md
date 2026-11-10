---
'@objectstack/scenarios': patch
---

feat(scenarios): the external driver contract carries the cost and tokens a command reports, and the scorecard and the gallery page state a channel's authoring cost only when every authoring turn reported one

Clause-②: no — `@objectstack/scenarios` has never been published (`npm view @objectstack/scenarios` answers E404 on 2026-11-10), so no released accept-set or public surface widens
Metadata-protocol: none

Additive: nothing is removed or renamed, and the contract name stays `objectstack-scenario-driver/1`.

- **The answer** to an `author` or `ask` call (`ExternalTurnSchema`) gains three optional keys: `reportedCostUsd` (the call's cost in US dollars as the tool reports it, zero or more), `inputTokens` and `outputTokens` (whole numbers, zero or more). A command that reports none answers the same contract. A figure of another shape is `invalid-output(…)`.
- **The turn and the run record**: the external driver carries each figure into the turn's `meta` only when the command reported it, and every turn in the run record (`TurnSummary`) now carries `reportedCostUsd`, `inputTokens` and `outputTokens` when its driver reported them, the `claude` CLI's `total_cost_usd` included. A turn that reported none records none, never a zero.
- **The scorecard** gains `authorCost` (`AuthorCost`: the authoring turns that ran, how many reported a cost, and their sum in `usd`), for the card and for each mode, with an `author cost:` line and an `Author cost` row. The sum is stated only when every authoring turn (build and iterate) reported a cost; otherwise it reads `not reported`, never a partial sum. `authorCost`, `authorCostText` and `usdText` are exported from `./runner`.
- **The gallery page** (`README.md` of each exported app) carries a `- Author cost (as the driver reported it):` line on the same rule. A record written before this release has no `authorCost` and reads `not reported`.
