---
'@objectstack/spec': patch
---

**`describeHighPrivilegeBits`'s wildcard example is a set that still has a wildcard (#6696).**

The JSDoc illustrated "a plain `'*'` wildcard grant is NOT high-privilege by
itself" with the platform's own `member_default`. After #5491 (PR #6684) that
set ships **no `'*'` entry at all** — the platform baseline narrowed to
explicit-allow by maintainer ruling — so the worked example named a set that no
longer has the shape being described, and a reader checking it would find
nothing and be left doubting the rule instead of the illustration.

The rule itself was never wrong and has not moved. `describeHighPrivilegeBits`
never reads `member_default`; it evaluates whatever set it is handed, and the
ADR-0090 D5 predicate is unchanged. Only the illustration is replaced, measured
against the shipped `defaultPermissionSets` array rather than transcribed:

- `viewer_readonly` carries `'*': { allowRead: true }` with every write, VAMA
  and transfer/purge bit explicitly `false`, and no `systemPermissions`.
- `describeHighPrivilegeBits(viewer_readonly)` is `null`, and
  `describeAnchorForbiddenBits(viewer_readonly, 'everyone')` is `null` — it is
  genuinely anchor-bindable, which is the property the sentence claims.
- `describeAnchorForbiddenBits(viewer_readonly, 'guest')` refuses it *for the
  wildcard*, so the replacement demonstrates both halves of the same sentence:
  anchor-safe for `everyone`, wildcard-banned at the stricter GUEST tier.
- `member_default` returns `undefined` for `objects['*']`, confirming the
  premise rather than assuming it.

The surrounding prose kept two things deliberately. The D5 shape widened from
"a read/create/edit-own baseline" to "a read — or read/create/edit-own —
baseline" because `viewer_readonly` is read-**only**: swapping the name without
widening the shape would have replaced one false illustration with another. And
the #2753 history — why the former blanket wildcard rejection was wrong — stays,
now reading "the then-wildcard-carrying default baseline" so the tense is
unambiguous next to the new `#5491` clause.

Documentation only — no implementation changed, no schema's accepted key set
moved, and this file is not a `.zod.ts`, so it reaches no page under
`content/docs/references/`. It is versioned because the comment ships to
consumers in the package's `.d.ts` (`dist/security/index.d.ts`), which is where
an editor hover reads it.
