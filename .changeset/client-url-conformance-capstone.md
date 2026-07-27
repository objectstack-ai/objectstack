---
"@objectstack/client": patch
---

test(client): close the route audit's reverse direction — every SDK URL must match a route some surface mounts (#3642)

The capstone of the #3563 route audit. The dispatcher (#3563), REST (#3587) and
service-mount (#3636) ledgers all run server → client: enumerate what a surface
mounts, demand a reviewed disposition, and for `sdk` rows demand the named
client method exists. None of them asked the reverse question — does the URL
the client *builds* match anything a server *mounts*? — so a method could name
a real function, carry a green ledger row, and 404 everywhere.

That shipped four times, found one at a time by hand: `analytics.explain` and
`analytics.meta` (#3584), `meta.getView` (#3611), and `i18n.getTranslations` /
`getFieldLabels` (#3636) — the last pair having carried green `sdk` rows since
tranche 1.

`client-url-conformance.test.ts` drives every method on a real client with a
recording `fetch` and matches each captured URL against the union of all four
ledgers. A real drive rather than a hand-written "method X targets route Y"
table, because such a table is an assertion *about* the code that the code can
drift away from — the exact failure being fixed. Mutation-checked: re-injecting
the #3636 dialect bug fails the suite.

The sweep's own completeness is asserted, since that is what rots silently — a
new method must be driven or declared `NON_HTTP` with a reason; a driven method
emitting zero requests fails (stale placeholder args are how a sweep quietly
stops covering anything); a URL containing `undefined` fails; and the
`__api-endpoint` `(unmatched)` catch-all is excluded from the pattern set so it
cannot match everything and make the suite vacuous.

196 of ~219 methods matched. Two bounds are reported rather than papered over:
`/api/v1/cloud/*` (23 `projects.*` methods) belongs to the sibling `cloud` repo
and is exempt by prefix, bounded so no other namespace can use it (#3655); and
60 of ~196 matched calls rest only on a `**` prefix claim rather than a
resolvable route — 54 of those on `* /auth/**` — a count the guard ratchets so
it can only shrink (#3656).

No runtime change: this is a guard plus the ledger-header and audit-doc notes
recording what it does and does not cover.
