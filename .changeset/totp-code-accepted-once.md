---
'@objectstack/plugin-auth': patch
---

fix(auth): a TOTP code is accepted once

Clause-②: no
Metadata-protocol: none

A TOTP code that `/api/v1/auth/two-factor/verify-totp` accepts is remembered for its user and secret for as long as the verifier's window could still accept it. Any later presentation of that code is refused, whether it arrives on another sign-in challenge, from another client, on another server node or on the session lane (RFC 6238 §5.2). A code from a time step at or before the last accepted step for that user and secret is refused too. A refused code gets the answer a wrong code gets (`401 INVALID_CODE`) and counts toward the challenge's attempt budget and the account lockout in the same way. The same rule covers the code that confirms an enrolment, and every later code. A code from a later time step is accepted as before.

The spent steps are kept as short-lived `sys_verification` rows, one per step, reserved under a primary key derived from the user, the secret and the step. Two presentations of one code that arrive together therefore admit exactly one, across processes and nodes. A store error while recording a step fails that verification. A client that signs in with TOTP more than once inside the same 30-second step needs the code of a later step for its second sign-in.
