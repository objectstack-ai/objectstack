---
"@objectstack/spec": minor
---

`UserSchema.image` and `OrganizationSchema.logo` are declared `z.string().url().nullish()` — a URL string, `null`, or the key absent are all accepted — so the user and organization bodies this platform serves parse against the schemas it publishes (#18509).

Both were `z.string().url().optional()`: a URL string or the key's absence, and `null` refused. Both columns are better-auth-owned and nullable — `sys_user.image` and `sys_organization.logo` are each `Field.url({ required: false })`, reaching SQLite as `varchar(255)` with `notnull=0` — and better-auth SELECTs them and serialises them present-and-null for a user who never set an avatar and an organization created without a logo.

Measured through a real `AuthManager` (better-auth 1.7.3) over a real `ObjectQL` on a real `SqliteWasmDriver`, with the platform's own `sys_user` / `sys_organization` object definitions:

```
/auth/sign-up/email            -> user.image  = null
/auth/get-session              -> user.image  = null
/auth/organization/create      -> logo        = null
/auth/organization/list        -> [0].logo    = null
/auth/organization/get-full-organization
                               -> logo        = null
                               -> members[].user.image = null

UserSchema.safeParse(<the served session user>)
  -> [{ path: ["image"], code: "invalid_type",
        message: "Invalid input: expected string, received null" }]
OrganizationSchema.safeParse(<the served organization>)
  -> [{ path: ["logo"], code: "invalid_type",
        message: "Invalid input: expected string, received null" }, … ]
```

Those two paths now parse.

- **Measured, not inferred.** #18509 exists because PR #18501's contract review named these two siblings as *not measured* rather than folding them into the `SessionUserSchema.image` ruling it had. The verdict here comes from the probe above, run the way that ruling's own evidence was taken; the analogy was only ever a reason to look.
- **The declaration was the thing that was wrong.** Prime Directive #12's default — fix the producer, never widen the consumer — rests on the premise it states out loud, that we own both ends. We do not: the nullable columns belong to a third-party model, so PD #12's own exit clause is the operative sentence.
- **A pure widening.** `.nullish()`, not `.nullable()`: the key's ABSENCE is a legal shape today, so `.nullable()` would retire a live shape as the price of admitting `null`. Every body legal before this change is still legal.
- **`.url()` is kept, and it does not fight `null`.** These two declarations carry `.url()`, which `SessionUserSchema.image` did not, so the question had to be answered rather than copied. `.nullish()` wraps the whole `z.string().url()`: `null` and `undefined` are separate branches the URL check never sees, while a present string is still required to be a well-formed URL. Of six inputs — absent, `null`, `''`, a URL, a non-URL, a number — exactly one row moves, and it is the ruled one. `''` and `'not-a-url'` are still refused.
- **No key is added or removed** — both keys were already authored and already published, so no authorable surface moves and nothing is retired.
- **`OrganizationSchema` is not made whole by this.** The same probe found `metadata` served present-and-null and `/auth/organization/create` omitting the required `updatedAt`. Those are separate defects with their own reasoning, filed separately rather than folded in; #18509 asked about `logo`.
