---
"@objectstack/service-automation": patch
---

A wizard screen is no longer skipped after a durable pause because a record column happens to be an array.

`judgeHeadlessScreen` decides a screen was already answered by proving the negative: a field is **not** caller-supplied when the subject record carries that key and `params` holds the same value — necessary because the params bag a flow action arrives with is `{ ...record, recordId, <object>Id, ...params }`, so every column of the launched row is in there whether the caller named it or not.

That comparison was reference identity (`Object.is`), which is real in memory and does not survive persistence. A suspended run stores its context as JSON and resumes from the parsed copy — and the store is preferred over the in-process cache whenever one is wired, so no restart is needed. After that round trip an **array or object** column is equal but no longer identical: the record leg could not disprove it, the field read as caller-supplied, and a later screen with no required fields of its own was **skipped on a run that had supplied nothing**. An interactive user pressed a button and never saw a form they should have been shown; the run completed carrying the row's own value as if they had typed it. Reproduced end to end against a wired store, not inferred.

The record leg now compares by value (`isDeepStrictEqual`), which survives serialisation. That predicate compares primitives with `Object.is` itself, so this is a strict widening of the "not caller-supplied" set — every pair the old check called equal it still calls equal, plus the structurally identical non-primitives. More screens render, never fewer, which is the direction this module resolves every ambiguity in.

**Accepted cost, precisely.** A caller that genuinely re-sends a value structurally identical to the row's column is no longer distinguishable from the dispatcher's seed, so it now gets the screen rendered instead of skipped — a lost skip on a headless call, never a lost run, and the same trade the module's other legs already make. Scalar columns behave exactly as before, on both sides of a pause. The row-id leg keeps identity comparison deliberately: a row id is a scalar by construction, so serialisation cannot defeat it and there is nothing there to widen. Measured overhead is a deep compare per declared screen field at screen entry: ~1.5 µs added for a deliberately maximal screen that declares a field for every one of a ten-column row, which is about 38% of one `JSON.stringify` of the run context — a cost the durable store already pays on every suspend.

This closes the gap the same release's screen-flow headless-satisfaction note records as known.
