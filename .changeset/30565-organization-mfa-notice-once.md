---
'@object-ui/app-shell': patch
---

fix(app-shell): turning on Require MFA on an organization shows the grace period once, with the number Setup set

Clause-②: no
Metadata-protocol: none

An accepted save that turns `require_mfa` on for an organization now gets a save notice from the server that names who must enroll and the MFA grace period in force. The console still added its own line under it, which says the same thing with the default "7 days". So the toast told the administrator the grace period twice, and when Setup → Authentication set another number, the two lines disagreed.

The record form now leaves its own line out when the save answer's notice is the server's MFA notice. It recognizes that notice by its opening sentence, in each of the four languages the server writes it in, and not just by a notice being there: the answer carries one notice, the last one a hook or flow on the write set, so another notice on the same save keeps the console line. A save whose answer has no notice (a server that does not send one) shows the console line as before.
