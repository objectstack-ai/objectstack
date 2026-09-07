---
"@objectstack/service-automation": minor
---

`evaluateCondition` now refuses a malformed condition shape with the same `STRUCTURAL_CONDITION_SHAPE_REFUSAL` registration already raises — evaluation and registration share one refusal, so a shape that slipped past registration can never surface as a raw `TypeError` or as a silent `false`.

#15662 closed the reject set at the producer: `registerFlow` refuses a structural condition (`config.condition` on a node, `edge.condition`) that is neither CEL text nor an expression envelope. The evaluator was left saying the opposite thing in a different vocabulary, and that half matters because `evaluateCondition` is a **public method on an exported class** — a plugin reaches it directly regardless of what `registerFlow` admits, and a flow stored before that gate landed replays through it.

The unguarded read had three arms, all of them now refused by the shared `structuralConditionRefusal` — the same call `registerFlow` makes, not a second hand-written envelope that could drift from it:

- an envelope whose `source` is present and **not a string** (`{ source: 1 }`, `{ dialect: 'cel', source: 1 }`) reached `.trim()` and threw `TypeError: exprStr.trim is not a function`, naming no flow, no node and no expression;
- a value that is neither text nor envelope-shaped (`42`, `true`, `['a']`, `{}`, `{ dialect: 'cel' }`) was read as an **empty condition** and answered `false` — the "an unauthored branch must not open" rule applied to a value that was very much authored, on the same key a start node's **trigger gate** is read from;
- a malformed envelope carrying a non-predicate dialect (`{ dialect: 'cron', source: 1 }`) answered `false` one statement earlier still, at the dialect check, never reaching the source derivation at all.

**What still evaluates is unchanged, and is pinned as controls.** Bare CEL text and both envelope spellings evaluate exactly as before; an `ast`-only envelope still answers `false`; a well-formed non-predicate dialect (`{ dialect: 'cron', source: '0 0 * * *' }`) still answers `false` rather than being refused; absent, `null`, empty and whitespace-only conditions are still "not authored", not malformed. A malformed **string** still earns its own verdict — the brace trap or the ADR-0032 §1c CEL fault — never the shape refusal.

An app whose stored flow carries one of the refused shapes in a node or edge `condition` now fails that run loudly with a message carrying the rule, instead of skipping a branch in silence or faulting unattributed; the fix is to write the condition as bare CEL text (`record.rating >= 4`) or as an expression envelope.
