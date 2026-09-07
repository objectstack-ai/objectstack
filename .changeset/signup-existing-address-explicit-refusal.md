---
"@objectstack/plugin-auth": minor
"@objectstack/spec": patch
---

`POST /sign-up/email` for an address that already has a `sys_user` row is refused explicitly, instead of answering 200 for a row that is never written (#15587)

**This is a wire-behaviour change on one lane**: a call that answers `200 {"token":null,"user":{…}}` today answers `422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` after this change. Nothing is newly admitted — the response that changes is one that reported a creation that never happened.

### What was measured

Under audience posture `email_domain` (domain allowlisted, `selfRegistrationPermissionSet` resolvable), a sign-up for an address that already carried a `sys_user` row answered **200 with a freshly minted user id** and persisted nothing: no new `sys_user`, no `sys_account`, and the next sign-in a `401` with nothing anywhere explaining it. The same call on the same population under the `invite_only` default was refused honestly with `422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`. An operator, a provisioning script or the console reading the status code concludes the account exists — and this sits directly on the recovery path a locked-out deployment walks, where widening the posture to let a seeded person register is exactly the remedy an operator is pointed at.

### The mechanism

better-auth's sign-up route computes `shouldReturnGenericDuplicateResponse = requireEmailVerification || autoSignIn === false` and, when it is on, answers a duplicate with a synthetic in-memory user instead of throwing. **No insert is attempted and nothing is swallowed**: the vendor's `findUserByEmail` short-circuits ahead of `createUser`, which is why no row and no credential appear.

The posture is not itself the cause — it is only what arms the shield: a posture that permits self-registration **forces** `requireEmailVerification` on. Holding the posture constant at the `invite_only` default and moving only that flag reproduces the divergence exactly, which also means the defect was never confined to the widened postures: `emailAndPassword.autoSignIn: false` arms the same shield under any posture.

### The fix

The uniqueness refusal is raised on the `/sign-up/email` before-hook, the same seam and the same reason the audience-posture refusal is already raised there, and built from better-auth's own `BASE_ERROR_CODES` entry so both lanes answer byte-identically.

**Order is load-bearing: it runs only for a caller the posture already admitted.** Asking uniqueness first would hand an uninvited stranger an account-existence oracle under the `invite_only` default (422 for a real address versus 403 for an unknown one). After the gate, `invite_only` is untouched — a stranger still gets `SELF_REGISTRATION_CLOSED` and learns nothing.

**Operators of `open` / `email_domain` should know what the honest refusal costs:** on those postures a caller the audience gate admits can now distinguish an address that has an account from one that does not, where the synthetic 200 previously hid it. That is the disclosure the `invite_only` lane has always made to an invitation holder, and the platform's answer for a widened posture is now the same fact rather than a false receipt.

`USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` is registered in the ADR-0112 error-code ledger under `@objectstack/plugin-auth`: the platform now **emits** it rather than only passing it through, and an emitted-but-unregistered code is the silent fourth state that ledger exists to prevent.
