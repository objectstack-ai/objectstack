---
"@objectstack/objectql": minor
"@objectstack/runtime": minor
"@objectstack/cli": minor
---

**Feature:** a hook body can now name a record — `await ctx.title()` resolves the object's `nameField`, `await ctx.title('<lookup field>')` resolves a related record's, and a `formula` title is evaluated server-side (#11293).

A lowered hook body ships body-only and runs in QuickJS with no module scope, so it could reach neither a **formula** field (`ctx.previous` / `ctx.input` carry stored columns; a formula is computed on read) nor any accessor answering *"what is this record called?"*. The only way to name a record in a sentence was to re-implement the object's title inline, per hook. Measured in the exemplar app: **five** inline reimplementations, and in **four of the five** the `nameField` is a formula (`display_title`, `full_name`) — only `crm_opportunity.name` is a real column. Each copy duplicates a formula declared once on the object and drifts from it in silence, which the app had to compensate for with a repo-local test and a repo-local hygiene check.

What it actually produced was worse than duplication. The cheap thing to write with no title accessor is `record.id` — the one identifier a body always holds — and that shipped: eight sites across four hooks put a raw primary key into user-facing prose, and a walkthrough found 15 of 31 tasks in a demo org titled by a 16-character key. An agent writing a hook reaches for `${record.id}` for exactly the same reason, so the fix is to put the correct answer **closer to hand than the wrong one**.

```js
// this record — nameField, formula or stored column alike
await ctx.api.object('sys_notification').insert({ subject: `${await ctx.title()} was closed` });
// a related record, through the lookup column that holds its id
const account = await ctx.title('account_id');
```

**Cost, measured rather than asserted.** `ctx.title()` performs **no read at all**, formula included: it resolves against the record state the hook is already firing on — the same stored ⊕ payload state the declarative `condition` gate evaluates — and evaluates the declared expression in process through the read path's own plan builder and evaluator, so a hook's title and a `GET`'s title cannot diverge. `ctx.title('<field>')` costs **exactly one `findOne`** and no more, because the read path already materializes the related object's formula fields onto the row it returns.

**Capabilities are per form, because the cost is.** The related form requires `api.read` — the same token the equivalent hand-written `ctx.api.object(...).findOne()` needs, gating the same read — and the CLI's extractor infers it from `ctx.title(<argument>)`. The no-argument form requires **nothing**, since it has no read to gate; taxing the majority case with a grant it never exercises would work against the one property this accessor exists for. The related read goes through the body's own `ctx.api`, so it obeys the caller's scope and joins an open `ctx.api.transaction` rather than asking the pool for a second connection.

**It never falls back to the id.** No resolvable title ⇒ `null` inside the VM. An id-shaped string is a perfectly plausible title to whatever renders it, so the platform will not manufacture one; a caller that wants a fallback writes it and owns it. A formula that cannot evaluate is likewise absence, never a half-composed value.

Scope is the ruled design and nothing beyond it: hook bodies only. Hydrating `nameField` into the hook pre-image, general formula-field readability from bodies, and an action-body counterpart are each separate calls and are deliberately not taken here.
