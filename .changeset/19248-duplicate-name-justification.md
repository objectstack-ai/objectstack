---
'@objectstack/cli': patch
---

`collect-docs.ts` records what the `docs/duplicate-name` refusal rests on now that ADR-0048 §3.4 retired its older justification (#19248)

`docs/duplicate-name` refuses two owners declaring one doc name. The claim it
was once explained by — *"one registration overwrites the other"* — was retired
by ADR-0048, and a refusal whose stated justification no longer exists is worth
examining rather than inheriting second-hand. #19248 examined it.

**The verdict is that no wording change was warranted**, and the ADR text is
quoted into the rule's own docblock so the next reader does not have to
re-derive it. §3.4 retires a RUNTIME throw and nothing else — *"The
cross-package **throw is retired**; two distinct packages coexist on the same
bare name by construction."* — while keeping, in the same clause, the class
this lint belongs to: *"Authoring-time hygiene — an author shipping two
`page/home` in one package — stays covered by the `naming/namespace-prefix`
lint in `os lint`."* Both sentences are quoted verbatim, checked against
`docs/adr/0048-cross-package-metadata-collision.md` on this branch's base
(`13d52947d8`) rather than recalled.

The message already said `for authoring hygiene` and already declined the
retired claim by name, so what shipped was correct and stays byte-identical.
What the docblock gains is the ADR's own words, the card number the standing
**severity** disagreement is filed under, and the boundary between the two
questions: §3.4 hands authoring hygiene to a warning-only lint while this one
is `severity: 'error'`, which is a live question about the level and not about
the reason.

⛔ No behaviour changes. No rule, message, severity or accept set moves; the
only edited bytes are inside one docblock comment.

**This ships, which is why it carries a changeset rather than
`skip-changeset`.** `@objectstack/cli`'s published `files[]` is
`["dist","README.md","CHANGELOG.md"]` and the package builds with plain `tsc`
(`tsc -p tsconfig.build.json`, no `removeComments`), so the comment is emitted
into the tarball — measured on the rebuilt artifact: the new clause is present
in `dist/utils/collect-docs.js` (1 occurrence), the replaced spelling is absent
from all of `dist` (0), and `dist/**/*.d.ts` carries 0 of it because the block
sits above a non-exported helper. The rule's own runtime message resolves to
that same file as the positive control. So the published JS bytes move while
the declaration surface does not.
