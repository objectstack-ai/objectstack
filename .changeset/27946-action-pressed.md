---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

feat(spec): an action can show the reader already pressed it — `pressed`

Clause-②: yes (widening)
Metadata-protocol: added

`ActionSchema` gains one optional key, `pressed`: a CEL predicate over the same scope as `visible` (the record and the reader) that says this reader already acted, such as a "Helpful" vote on a knowledge article. While it evaluates TRUE an action surface draws the button pressed (`aria-pressed`). An action that does not declare it parses exactly as before.

```ts
defineAction({
  name: 'mark_article_helpful',
  label: 'Helpful',
  objectName: 'kb_article',
  type: 'script',
  target: 'markHelpful',
  locations: ['record_header'],
  pressed: "has(record.viewer) && record.viewer.vote == 'helpful'",
});
```

- **A CEL predicate, not a boolean.** A string is normalized to the `{ dialect: 'cel', source }` envelope, and the envelope is accepted as written. `pressed: true` / `false` is refused at parse: a constant draws every reader's button the same way, which is a style and not the reader's state. The blank and `ast`-only shapes every evaluated slot refuses are refused here too. `active`, `activeWhen` and `pressedWhen` are renamed onto it.
- **Display only.** It never gates, greys or routes the action. A pressed action stays runnable, and its own body decides what a second press does.
- **The reader's own state.** A per-reader fact is usually a child row (one vote per user), not a column. Declare it as a block under the object's `attachedOnRead`, attach it on the serving side for the caller (a service, or an `afterFind` hook that shapes the rows it returns), and read `record.<block>.<leaf>` behind `has()`.
- **Checked at build (`@objectstack/lint`).** `os build`, `os validate` and the object save door judge the predicate in the `record` scope, as they judge `visible`: a bare field reference is an error. An action's `pressed` is a served-row site, so a block the object declares under `attachedOnRead` resolves there and a misspelt leaf is refused.

Nothing draws the pressed face yet. The console's record header buttons and declared actions bar read the key in a follow-up change. Until then the liveness ledger marks it `planned` with `authorWarn`, so `os validate` warns an author who declares it that the button looks the same whatever the predicate answers.
