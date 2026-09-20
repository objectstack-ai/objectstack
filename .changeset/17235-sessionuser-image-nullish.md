---
"@objectstack/spec": minor
---

`SessionUser.image` is declared `z.string().nullish()` — a string, `null`, or the key absent are all accepted — so a signed-in user who never set an avatar parses against the schema this platform publishes (#17235).

`z.string().optional()` admitted a string or the key's absence, and refused `null`. better-auth owns the avatar column, stores it nullable, and serialises it present-and-null, so every `/auth/*` session body the platform produces carried a value the declaration rejected. Measured through a real `AuthManager` (better-auth 1.7.2) over a real `ObjectQL` on a real `SqliteWasmDriver`: `get-session`, `sign-up/email` and `sign-in/email` all serve `"image": null` for a freshly signed-up user, and the full envelope failed on exactly that one path:

```
SessionResponseSchema.safeParse(await client.auth.me())
  -> [{ path: ["data","user","image"], code: "invalid_type",
        message: "Invalid input: expected string, received null" }]
```

That parse now succeeds on all three routes.

- **The declaration was the thing that was wrong.** AGENTS.md Prime Directive #12's default — fix the producer, never widen the consumer — rests on a premise it states out loud, that we own both ends. We do not: the nullable column belongs to a third-party model, so PD #12's own exit clause ("change the spec only when the spec itself is genuinely wrong, and then deliberately") is the operative sentence. Normalising `null` away at the producer seam was considered and refused: it is a permanent rewrite layer between the platform and a dependency's data model.
- **A pure widening, and nothing else.** `.nullish()`, not `.nullable()`: the key's ABSENCE is a legal shape today and no producer was ever measured omitting it, so `.nullable()` would have retired a live shape as the price of admitting `null`. Every body legal before this change is still legal.
- **Still refuses what it should.** A number and an object are rejected at `data.user.image` exactly as before; the only accept-set row that moved is `null`.
- **No key is added or removed** — `image` was already authored and already published, so no authorable surface moves and nothing is retired.
