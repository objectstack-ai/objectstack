---
'@objectstack/runtime': patch
---

Restate the `CodeVerdict.pending-registration` doc comment in `dispatcher-error-vocabulary.ts` in post-#9106 terms.

The doc comment said the verdict "reaches a wire `error.code` verbatim" and "the body cannot parse" — both false since #9106 narrowed the dispatcher door: the unregistered spelling now rides the wire's `declaredCode` instead of `error.code`, so the body parses, and what an unswept producer loses instead is its semantic code, silently demoted off `error.code` until registered. The file's own module header and the gate script's header already said so; only the verdict doc comment was the holdout, and it is the classification guide a future `unclassified-site` finding gets picked from. Prose only — `verdict:` values, row data and the gate script are unchanged; `check:dispatcher-error-vocabulary` parses `verdict:` textually with comments masked, so no gate reads this text and no behaviour moves.
