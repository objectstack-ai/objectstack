---
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

fix(console): the publish-health line shows a finding's customer sentence and folds the agent text under technical details

Clause-②: yes (widening)
Metadata-protocol: none

The line under a Published badge in the AI build chat printed each runtime finding's `message` as it arrived. That text is written for the agent that repairs the build ('Seed "x" loaded 0 rows … republish the seed'), so the customer read instructions meant for the AI. The producer of a finding now writes the customer sentence (`userMessage`), and the line follows it:

- **A finding with a `userMessage` shows that sentence on the line.** `publishHealthFromResponse` reads `probes.issues[].userMessage`, and `fix`, when each is a non-empty string, onto `PublishHealth.issues[]` (both optional, new).
- **A finding without one shows the generic sentence the draft-issues block already says** (`chatbot.build.issuesSummary` when an error is in the set, else `chatbot.build.warningsSummary`), once for all such findings.
- **The agent text leaves the line.** Every finding's `message` (with its `fix`) and the seed loader's own failure text sit under a closed "Technical details" (`chatbot.build.issuesDetails`), the face the draft-issues block uses.
- **A failed seed says so through the locale pack.** The line reads `chatbot.build.health.seedFailed` ("Sample data failed to load.", new in every pack, zh-Hant generated from zh-Hans) instead of the loader's English. `PublishHealth.seedFailed` (optional, new) marks the failure; `seedError` now holds only the producer's own text and is absent when it sent none, where it used to hold an English sentence the reader made up. A loader finding object in `seedApplied.errors[]` gives its `message` instead of `[object Object]`.

The widening: new optional `PublishHealth` fields (`seedFailed`, `issues[].fix`, `issues[].userMessage`) and one new i18n key (`chatbot.build.health.seedFailed`); nothing is removed or renamed.
