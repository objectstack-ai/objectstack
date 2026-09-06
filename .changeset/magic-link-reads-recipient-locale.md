---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): the magic-link mail reads the recipient's own `sys_user.locale` (#15106)

`sendMagicLink` was the last of the five auth mail sends still on the two-rung
#14319 ladder — the request's `Accept-Language`, then the deployment default.
#14762 put the recipient's stored `sys_user.locale` above both at the three
sends that hold a user row, and #14641 reached the invitation; the magic link
was fenced out because it is handed `{ email, url, token }` and no row, so the
column has to be read on the address rather than on an id. The visible cost was
one deployment answering the same person in two languages: a Chinese
password-reset mail and an English magic link, decided by whichever browser
happened to send the request.

It now reads the column behind the existing placeholder-address refusal, in the
same shape #14641 gave the invitation send — one projected `findOne` on
`sys_user` under a system context, best-effort, and never a reason a send fails.
This completes the #14788 option-D ladder (`sys_user.locale` when set → the
request's `Accept-Language` → the deployment default) across the whole auth mail
surface: all five `sendTemplate` sites now answer per recipient.

The request rung is kept rather than replaced. A magic link is requested BY its
recipient, so its `Accept-Language` is the recipient's own and remains a
legitimate second rung for an account that has stated no language; ruling D
inserts the column above the header, it does not remove the header.

Two branches, because a magic link is also a sign-up: an address that carries a
row is written in that account's language, and an address with no row keeps
exactly the previous behaviour. The address is lowercased for the lookup —
better-auth applies no case transform to the magic-link request body, while
`findUserByEmail`, which `/magic-link/verify` resolves the very same link with,
matches on `email.toLowerCase()`, so the column is read for the row the link
will sign into. An address that resolves nothing lands on the rungs below, which
is the documented floor.
