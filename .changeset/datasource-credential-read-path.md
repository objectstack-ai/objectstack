---
"@objectstack/service-datasource": patch
---

fix(service-datasource): the datasource read path stops serving stored credentials in cleartext, and the "credential-stripped" comment stops lying (#8081)

`GET /api/v1/datasources/:name` returned the driver `config` **verbatim**, while
the method producing it carried a doc comment promising the opposite —
"with the credential stripped", `config` described as "non-sensitive —
credentials live in `sys_secret`, never in config". Nothing stripped anything.

The comment was not merely stale, it was **load-bearing**: it is the reason the
gap survived a 26-surface credential survey. A safety claim that no code performs
is worse than no claim, because it stops the next reader from looking.

#8078 closed the WRITE door — `config.password` / `config.authToken` are
declared-unwritable on every driver that has them, so no new row can carry an
inline credential. It deliberately did not touch rows already stored. Those rows
still hold cleartext, and until now the admin read path handed it to every caller
of that route.

**What is redacted.** The refused-key set is DERIVED from each driver's own
contract rather than retyped here: #8078 spells a refused inline credential as
`z.never()`, so the schema *is* the list, and a credential key refused tomorrow
is covered the day it lands. Three sources feed the scrub — the derived keys, the
pre-#8078 alias spellings (`passwd`/`pwd`/`token`/`jwt`/`auth_token`/`authtoken`,
which a stored row can still hold verbatim because the wizard persists through
`metadata.register` and never met the parse that would have renamed them), and
turso's `encryptionKey`, an AES-256 key that remains writable because the secret
binder has no slot for it. A driver the platform ships no contract for still has
the canonical spellings hidden by name: declining to *refuse* an unrecognised key
is a boundary choice about authoring, while serving a key literally named
`password` back in cleartext is a leak under any boundary.

**URL-embedded credentials.** A `postgresql://user:pass@host/db` in `config.url`
carries the same secret as `config.password`, and a scrub that dropped one while
serving the other one key over would be a scrub in name only. The read path now
redacts the **password component of a URL's userinfo**, preserving the scheme,
the username and everything from the host onward. Refusing such a URL at the
write door remains deliberately **unruled** (#7990) and is untouched: redacting a
value on the way out is not the same act as refusing it on the way in.

**The response says what it withheld.** `getDatasource()` gains
`redactedConfigKeys`, so a caller knows a credential is being held back rather
than inferring it from an absence — the same courtesy the existing `hasSecret`
flag pays for the bound `sys_secret` handle.

**A round-trip no longer destroys the credential — and no longer 400s.** The
edit form reads this config and patches it straight back, so a scrub without an
inverse would have turned every untouched "Save" into silent credential deletion.
`updateDatasource` therefore carries the hidden material forward when a patch is
round-tripping the same driver's config, after the validation gate rather than
before it: the gate judges what the *author* wrote, and this material is
something the author never saw and is not asking to change. Restoring it is the
same rule the `credentialsRef` beside it has always followed.

This also repairs a regression that arrived with #8078 and is measured here for
the first time: on `main` the form was served `config.password` verbatim, posted
it back unchanged, and the write gate refused it — so **editing any legacy
datasource through the wizard answered 400 for a value the server itself had
just supplied**, including the `active: false` that takes a misconfigured
datasource out of service.

**Not changed.** The stored record is never mutated: redaction is a read-path act
only, the connect path reads the raw record, and a legacy datasource keeps
authenticating exactly as before. Getting cleartext *out* of the store is a
migration with its own decision to make and is not attempted here.
