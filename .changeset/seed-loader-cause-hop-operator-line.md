---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): the seed loader's operator line reaches through `cause`, so an enveloped driver fault still names what the database said (#14095)

The seed channel has two halves by design: the payload quotes a caught sentence only when the producer DECLARES a client refusal, and the log carries the caught sentence ALWAYS — because withholding text that nothing else records is indistinguishable from deleting the diagnostic, which is what makes a disclosure fix a net loss for whoever has to fix the database.

`seedFailureCause` read `err.message` and nothing else. That was complete while every producer put its whole diagnosis there. It stopped being complete the moment one of them started ENVELOPING: `engine.insert` now answers a driver unique violation with `DUPLICATE_RECORD` / `status: 409` and keeps the driver's own error whole on `cause`, so the platform sentence sits on `message` and `UNIQUE constraint failed: dt_acct.email` sits one hop down. Read off `message` alone, the operator line printed the platform sentence and the driver's words reached **neither the response nor the log** — the exact loss the two-halves design exists to prevent, arriving through a producer doing the right thing.

So the log follows the hop: `seedFailureCause` now walks the `cause` chain (bounded at 4, the depth `@objectstack/types`' unique-violation predicate walks) and prints the DEEPEST non-empty sentence — the one no wrapper above it restates. The walk is structural, never a type check: this package must not import `@objectstack/objectql`, and an envelope from any producer earns the same treatment.

`seedCauseLabel` moves with it, because the marker would otherwise go false. It used to ask "was this ERROR's text withheld from the payload?", which was the same question while the printed sentence was always `err.message`. Now the two differ: an enveloped fault has its PLATFORM sentence quoted to the caller and its DRIVER sentence printed to the operator, and the old question answered `Cause` — telling an operator the reporter saw words the reporter never saw. It now compares the sentence about to be printed against the one the payload actually quoted, so `Cause` means "these are the same words". All three populations stay correct: withheld outright, enveloped, and plainly declared.

No behaviour changes for a producer that carries no `cause` — the walk finds nothing and returns `err.message`, byte for byte as before.
