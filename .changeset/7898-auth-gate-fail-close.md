---
'@objectstack/core': patch
---

fix(core): an absent or empty path is no longer exempt from the ADR-0069 auth gate (#7898)

`isAuthGateAllowlisted` answered `true` for a falsy path — it treated "no path"
as allow-listed. That is a fail-OPEN default on an authorization seam: any
caller that reached the ADR-0069 gate with an absent or empty `path` was exempt
on **every** route, and a transport author who simply forgot to populate `path`
disabled the gate with no diagnostic of any kind.

```
FROM  isAuthGateAllowlisted(undefined)  ->  true   // exempt, on every route
      isAuthGateAllowlisted('')         ->  true

TO    isAuthGateAllowlisted(undefined)  ->  false  // exemption must be earned
      isAuthGateAllowlisted('')         ->  false
```

Exemption is now something a path has to EARN by naming an allow-listed route,
so the failure mode of omission is a `403` rather than a bypass. The predicate
is split in two so it carries exactly one meaning: a private
`matchesAllowlistedRoute` answers the route question for a real, non-empty path
— its body is unchanged, the #16839 anchoring rules included — and the exported
predicate answers "is this request exempt", which a request with no path is not.

**No current caller's behaviour moves.** The caller census was re-run: the same
four production call sites, and no fifth. Two of them (`RestServer.enforceAuth`,
`shouldDenyAnonymous`) already guard for a non-empty path and so only ever reach
the predicate with a real string; a corpus differential against the pre-flip
predicate over more than 10,000 paths moves exactly one input — the empty string
— and nothing else, in either direction.

**The one exemption that remains for a genuinely pathless caller is explicit**,
and lives at the one seam that really routes by body: `shouldDenyAnonymous`
declares `path` optional and decides the no-path case itself (it denies), ahead
of this predicate. That guard is deliberately kept rather than collapsed into
the now-agreeing default — a seam's contract should not be re-derived from what
a predicate happens to do with a falsy argument.

**Known follow-up, tracked as #17625.** The dispatcher's bare-root
`` `${prefix}/` `` arrives as `cleanPath === ''` (the trailing slash is
stripped), which was exempt via the fail-open default and is not exempt now, so
a *gated* session — one carrying an `authGate`, i.e. an expired password or a
required MFA enrollment — reaching the bare root gets a `403` instead of the
discovery payload. Every named remediation route (`/auth/*`, `/health`,
`/ready`, `/discovery`, `/me/apps`, `/me/localization`) is unaffected, so
remediation itself stays reachable. Normalising that empty `cleanPath` is step 2
of the same ruling and is **not** a tolerance re-added here.
