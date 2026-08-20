# merge-queue-triage corpus

Input for `scripts/check-merge-queue-triage-outcome.mjs`, which drives the
inline `actions/github-script` of `.github/workflows/merge-queue-triage.yml`
under doubles. Nothing here is invented; each file states what it is evidence
of. The ESC byte is stored in its **escape spelling** (`\u001b`, six
characters) because a raw 0x1b in a repo file fails
`scripts/check-nul-bytes.mjs`; the harness materialises it before feeding the
extractor.

| file | provenance |
|---|---|
| `plugin-dev-timeout.job-log.txt` | Real vitest 4.1.10 output, captured 2026-08-20 in this repo. `packages/plugins/plugin-dev/src/dev-plugin-security-enforcement-warning.test.ts` at revision `7552e03375` (pre-#10120), unbuilt dependency closure, `vitest run --testTimeout=1`. |
| `plugin-dev-assertion.job-log.txt` | The same file, same revision, same unbuilt closure, no timeout override -- the exact condition #10112 measured, reproducing `AssertionError: start() published the service: expected false to be true` verbatim. |
| `incident-32333709633-published-excerpt.job-log.txt` | Verbatim from the triage comment the bot **posted** on PR #10008 for queue build `32333709633` (comment `5351634659`), read back through the API. This is what a human actually saw during the 2026-08-20 incident. |

The first two are a **pair**, and the pairing is the point: their `FAIL` lines
are byte-identical and their reason lines are opposite diagnoses. Scenario `E3`
asserts that identity rather than describing it, so the two captures cannot
drift into obviously-different logs and leave the claim unproven.

The third carries the measured *before*: no reason line anywhere in it, and
four of its seven lines are `stdout | ...` noise admitted only by the
multiplication sign inside a test **title**. Both defects are pinned by
scenario `E4`.

Regenerating the first two: check the test file out at `7552e03375` into a
worktree with no `packages/plugins/plugin-security/dist`, run
`packages/plugins/plugin-dev/node_modules/.bin/vitest run <file>` (add
`--testTimeout=1` for the timeout leg), then replace every ESC byte with
`\u001b` before writing the file back here.
