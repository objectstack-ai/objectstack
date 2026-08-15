---
"@objectstack/plugin-sharing": patch
---

fix(plugin-sharing): stamp the filter-subtree provenance mark at the read merge, so an author's own cross-field refusal stops being redacted on the sharing-composed path (#8430)

`#8220` declared the filter-subtree provenance mark and set it at two read-scope
merge boundaries — `plugin-security`'s CRUD injection and `service-analytics`'
`withReadScope`. `plugin-sharing`'s read path is a **third**: on every read it
AND-composes an OWD / record-share visibility filter into `ast.where`, and it
stamped nothing.

Two marks, and they are not the same job:

- **the scopes it injects are marked `'policy'`** — the OWD/record-share read
  filter, the delegator's intersected filter (ADR-0090 D10) and the
  `sys_record_share` self-scope (ADR-0111 D5). **No behaviour change**: an
  unmarked subtree already withheld, so these refusals kept the `#7929`
  redaction before and keep it now. What changes is that the withhold becomes a
  *declared* verdict instead of an accident of the mark's absence — which
  matters because an unmarked node **inherits its ancestor's mark positionally**
  (`resolveFilterSubtreeProvenance`, innermost wins), so an unmarked policy arm
  nested inside a vouched subtree would read as the author's.
- **the caller's own predicate is vouched `'author'`** immediately before the
  rewrite that would otherwise make it unrecognisable to every later boundary.
  This is the one user-visible change: an author's own `{ $field }` refusal on
  an object with active sharing again names its columns, its operator and its
  reason, instead of the redacted "operands withheld" text.

**The vouch is an identity check, not a heuristic.** The mark is stamped only
while `ast.where` is still, by object identity, the `where` the caller handed
the engine. If a sibling middleware already composed into it, or the engine
rewrote it resolving filter tokens, identity fails and **nothing** is vouched —
the tree stays unmarked, and unmarked withholds. The arms of a pure
`{ $and: [ … ] }` root are vouched too, because `composeAnd`'s flattening branch
spreads that root's arms into a new object and would otherwise drop the vouch
out of the tree with it (that shape is what the array authoring form lowers to,
so it is the common case, not an edge one).

**Fail-closed is unchanged in every direction**, and the pins say so at a real
`SqlDriver`: the injected scope still withholds, a policy arm sitting beside an
author-vouched arm in the same `$and` still withholds, and a predicate no
boundary ever vouched still withholds byte-identically to the policy case.

**The write path is untouched.** `buildWriteFilter`'s composition is a different
question with different consequences and was not declared by `#8220`.

Measured while implementing, and worth recording because the card says
otherwise: in a stack that composes **both** plugins, the author vouch was
already surviving. `plugin-security` is registered before `plugin-sharing` on
both real boot paths and `resolvePluginOrder` preserves insertion order, so
security vouches first and its mark — which lives on the caller's object —
travels through this composition untouched. The gap this fixes is a stack that
mounts `plugin-sharing` **without** `plugin-security`, where nothing else can
vouch for the caller.
