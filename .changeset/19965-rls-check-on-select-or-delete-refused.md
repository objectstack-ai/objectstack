---
'@objectstack/spec': minor
---

**BREAKING for authored metadata** — a row-level security policy (`RowLevelSecurityPolicySchema`, authored as `rowLevelSecurity[]` on a permission set) whose `operation` is `select` or `delete` may no longer declare a `check`. It is refused at parse, at the `check` path, with a message that names the operation and says what to write instead (#19965).

Clause-②: no

## What changed, and why

`check` judges the post-image of a write: the new row of an insert, the changed row of an update. A `select` or `delete` writes no row, and the runtime's write gate only ever collects the policies whose `operation` is the write's own or `all`. So a `check` on a `select` or `delete` policy was accepted, stored and **never evaluated**. It did not guard any write, and beside a USING-only sibling it did not replace that sibling's `using` default the way a `check` on an `insert`, `update` or `all` policy does. An author who wrote a `check` on a `delete` policy believed deletes were guarded by it (ADR-0049: declared is not enforced).

```
FROM  RowLevelSecurityPolicySchema.safeParse({
        name: 'no_archived', object: 'account', operation: 'delete',
        using: 'owner_id == current_user.id', check: "status != 'archived'" })
      -> { success: true }            // the check never ran

TO    -> { success: false,
           issues: [{ code: 'custom', path: ['check'],
                      message: '`check` is never evaluated on a `delete` policy: it validates the new
                                row an insert or an update writes, and a delete writes none. Remove
                                `check` from this policy. …' }] }
```

Through a permission set the issue lands at `rowLevelSecurity[N].check`; through `defineStack` it is part of the `STACK_SCHEMA_INVALID` refusal (422).

## Migration — FROM → TO

| You wrote | Write instead |
| --- | --- |
| `operation: 'select'` with a `check` meant to limit which rows can be read | that predicate as the policy's `using` (AND it into an existing `using` with `&&`), and remove `check` |
| `operation: 'delete'` with a `check` meant to limit which rows can be deleted | that predicate as the policy's `using` (AND it into an existing `using` with `&&`), and remove `check` |
| `operation: 'select'` or `'delete'` with a `check` meant to validate written rows | the `check` on a policy whose `operation` is `insert`, `update` or `all` |

**The one-line fix: remove `check` from every `select` / `delete` policy, and write its predicate as that policy's `using` or on an `insert` / `update` / `all` policy, depending on what it was meant to guard.** This cannot be converted automatically: dropping the key would discard the predicate, and moving it would change which rows the policy admits. So it ships as an ADR-0087 D3 structured TODO with **no D2 conversion**.

<!-- adr-0087: registered rls-check-on-select-or-delete-policy-refused -->

## Stored permission sets

Stored rows are not rewritten. A permission set already stored with a `check` on a `select` or `delete` policy is refused the next time it is parsed through `@objectstack/spec`, for example on its next save. Removing the `check` changes nothing at runtime, because it never ran. Moving its predicate into `using` or onto a write policy does change behaviour, so re-check the policy set afterwards.

## What does NOT change

- A `check` on an `insert`, `update` or `all` policy parses and is enforced exactly as before.
- A `select` or `delete` policy with `using` only parses exactly as before.
- A blank `check` (empty or whitespace only) declares nothing, and the runtime reads it as absent. It is not refused by this rule.
- No export is added, removed or renamed.
