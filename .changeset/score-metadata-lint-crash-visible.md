---
"@objectstack/cli": minor
---

`scoreMetadata` no longer scores a stack whose linter crashed as a perfect one.

The metadata rubric is two halves: a schema parse and the lint sweep. When `lintConfig` threw, the scorer caught the throw and continued with `issues = []` — so the penalty was 0 and a stack half of whose rubric never ran came back as **100 / grade `A` / `valid: true`, every count zero, `issues: []`** — byte-for-byte the verdict a genuinely clean stack gets. "The linter found nothing" and "the linter never ran" collapsed into the better-looking one.

The crash is reachable on a schema-valid stack: a localized `label` (`{ en: 'Todos', 'zh-CN': '待办' }`) on an app, or on a view's `list`, parses clean and makes the label-case rule throw a `TypeError`. That rule's crash is a separate defect, filed on its own; what changes here is that the scorer stops publishing a clean verdict it did not earn.

A crashed lint run is now recorded in every carrier a consumer might read, because reading any one of them has to be enough:

- **`lintError`** — a new optional string on `MetadataScore`, carrying the thrown message. Set only when the linter could not run; absent when it ran and reported errors, which is a lint verdict rather than a missing one. It reaches the CLI's published payload through `os lint --eval --json`, on `results[].score`.
- **A synthetic `error` issue** (`rule: 'rubric/lint-crashed'`, exported as `LINT_CRASHED_RULE`) — so `issues`, `counts.errors` and `valid` carry the failure too. This is what makes the eval harness fail the case: its `passed` reads `counts.errors`, and would never have seen a new field. It still fails at `--eval-min 0`, where the score alone stops discriminating.
- **`score: 0` / grade `F`** — the only channel `os lint --score --json` publishes, and the same refusal `unscorableScore()` already gives an eval case there was nothing to judge.

The schema half is untouched and still reported: `schemaErrors` and `counts.schemaErrors` say exactly what the parse found, which was the defensible half of the original intent.
