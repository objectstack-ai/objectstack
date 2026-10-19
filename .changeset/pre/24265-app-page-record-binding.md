---
'@objectstack/spec': minor
---

Clause-②: yes (widening)

feat(spec): an app page binds its row as `record`, so a component `visibleWhen` can follow a bound count or a plan field

- **What it adds.** `PageSchema.record` (`PageRecordBindingSchema`): a one-row query `{ object, view?, filter?, sort? }` on a `type: 'app'` page. The page's row is the FIRST row of that query, read under the caller's identity, and every component predicate on the page reads it as `record`, the root ADR-0089 D1 already names for runtime surfaces. No new expression root is added.
- **What a predicate reads.** A count or a plan is a field on the bound row: a `summary` (roll-up) field (`record.environment_count > 1`) or the object's own field (`record.plan != 'free'`). `features.*` is not a plan: that root is the deployment's public auth flags (`/api/v1/auth/config`), the same for every organisation and every viewer. The `visibleWhen` docblock and describe now say so, and they say that a block's own element `dataSource` binds no `record` for its siblings or for its own `visibleWhen`.
- **What it refuses.** `record` on any page that is not `type: 'app'` is refused at parse (`checkPageRecordBindingPlacement`, exported from `@objectstack/spec/ui` like the other page checks): a record page's row is the record it opens, and a `home` / `list` / `utility` page has no row. Inside the binding, `limit` is refused with a prescription (a page binds one row; say which with `sort` or `filter`), and so are `id` / `recordId` (match the row with a `filter` rule on `id`).
- **Planned in the renderer.** The console does not mount the binding yet: until it does, `record` stays unbound on an app page, as before, and a predicate reading it faults, so the component renders. The liveness ledger grades the key `planned`.
- **Unchanged:** every existing page, component and predicate; the predicate root set (`record`, `current_user` with its aliases, `page.NAME`); the lint's declared roots.
