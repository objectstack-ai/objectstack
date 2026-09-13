---
"@objectstack/spec": patch
---

fix(spec): stop advertising `app` as an expression-scope root the shipping renderer mounts (#17203)

Six prose faces of the UI schemas told an author that a CEL predicate could name `app` — that the shipping renderer mounts it alongside `features` and `os.user`. It does not, and it never contractually did. `@objectstack/formula`'s `SCOPE_ROOTS` has never declared `app`, and ADR-0068 has never ruled it; decision batch #67 (2026-09-07) ruled option B — the engine's `SCOPE_ROOTS` is the contract and ObjectUI aligns to it — and ObjectUI shipped that, so `buildExpressionScope` no longer binds `app`. The producer-side option-A card (widen `SCOPE_ROOTS` to match the old prose) was closed `not_planned` in the same ruling.

The `app` token is deleted from all six. `features`, `os.user`, `data`, `current_user`, `record` and `user` all stay, in place and in their existing order, and the "renderer behaviour, NOT contract-guaranteed" framing is unchanged:

- `ui/page.zod.ts` — the "Ambient roots" docblock, and the **published `.describe()`** on `PageComponentSchema.visibleWhen`, which republishes verbatim into `content/docs/references/ui/page.mdx` (regenerated here).
- `ui/action.zod.ts` — the param-level `visible` docblock, and the **action-level `visible`** docblock, which stated the same claim unbackticked (`record/user/app/features`) and was invisible to a probe shaped for the backticked token.
- `ui/component.zod.ts` — the `page:tabs` ambient-root name-resolution example, and its "also mounts the ambient …" sentence.

Why this was worth correcting rather than leaving to rot: this `.describe()` is the surface an authoring tool and a metadata-generating agent read (ADR-0033 lists AI as a primary consumer), and it was the last place anywhere that could still teach either to write `app.tier == 'pro'`. The resulting predicate does not fail uniformly and is silent both ways — a field `visibleWhen` and a nav / area `visible` fail OPEN (the gate stops hiding), a conditional-formatting `condition` and a row-action `visible` / `disabled` fail CLOSED (the rule silently stops matching).

No accept set moves: `SCOPE_ROOTS` is untouched, every schema parses exactly what it parsed before, and a predicate naming `app` is accepted and rejected precisely where it was. This narrows what the protocol advertises, and nothing else. A pin test now holds all six faces, published and TSDoc alike.
