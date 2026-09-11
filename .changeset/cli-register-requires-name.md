---
"@objectstack/cli": patch
---

fix(cli): `os register` requires a name, and the request-side `as any` that hid the mismatch is gone (#16932)

`os register` prompted **"Name (optional)"**, typed its own payload with `name?`, and guarded `email` and `password` but not `name` — three places agreeing the field was optional. The route it actually posts to does not agree: on a fresh environment (no human user yet, so the audience gate's bootstrap bypass admits the request and the route's own validation is the only judge left), `POST /api/v1/auth/sign-up/email` answers `400 VALIDATION_ERROR` — `[body.name] Invalid input: expected string, received undefined`. The same run with a name supplied answers `200` and creates the account.

So the first-use path failed on exactly the answer the prompt invited, and `RegisterRequestSchema`'s required `name` was right all along.

- the prompt now reads `Name: `;
- an empty answer is refused by the CLI itself (`Name is required`), beside the existing `Email is required` / `Password is required` guards, before any request goes out;
- the payload is annotated with the declared `RegisterRequest` instead of a hand-written twin;
- the `as any` at the call site is removed, so the next divergence between this command and the declared request type is a compile error rather than a `400` a user meets on their first command.

No behaviour change for anyone already passing a name, by flag or at the prompt.
