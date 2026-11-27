---
'@objectstack/skills': patch
---

docs(skills): the lifecycle rule teaches which sealed objects take signed expiry, and that a retention override cannot shorten a packaged sealed object's declared window

Clause-②: no (published prose only; teaches behaviour already on main)
Metadata-protocol: none

`skills/objectstack-data/rules/lifecycle.md` (Sealing) no longer says expiry is not built and that the sweeper deletes every sealed object's rows. It now says: signed expiry covers objects whose lifecycle is declared in packaged metadata, whose sealed rows leave only by whole checkpoints and read as `expired`; on such an object with no `archive`, a retention override below the declared window is rejected and the declared window applies, and to keep rows for less time the declared window is what to shorten; on any other sealed object (one created at runtime) the sweeper still deletes sealed rows, which then read as missing. The `retention_overrides` row of the Operations table points at that paragraph.

The same sentence said no verifier is built. `os audit verify` reads the checkpoints back, so that clause is removed.

The file sat at its token ceiling, so the words are paid for in the same file and no ceiling moves: the page drops the rationale sentence after "the file never shrinks" and its echo in the first validation example, the example list in the rule sentence (the Lifecycle Classes table carries a typical use per class), the hook names in the intro, the rationale clause of the Separation bullet, and three filler words in Safety Semantics.
