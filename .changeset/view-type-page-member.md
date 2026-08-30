---
"@objectstack/spec": minor
"@objectstack/lint": minor
"@objectstack/metadata-protocol": patch
---

feat(spec,lint,metadata-protocol): a `page` member on the `view` type enum — mount an already-published page on an object view (#13216)

A custom page created and published at runtime through the metadata API had no
in-protocol way to reach an end user (#13100's evidence map). App navigation is
closed to runtime content (`app.allowOrgOverride: false`), and the `view` `type`
enum — on one of the five types the platform deliberately leaves open
(`allowOrgOverride: true`, `allowRuntimeCreate: true`) — was closed over
declarative row renderers, so a published page could not be mounted as an
object's list view or tab.

Maintainer ruling 2026-08-29 (live director session, verbatim 「同意」), 方向 1:

> `view` 的 `type` 枚举新增 `page` 成员——对象的列表视图/标签页可挂载一个已发布页面。走平台**有意开着**的门(`view` 本就 `allowOrgOverride=true` + 运行时可创建),零新增授权面;设计要点:`page` 型 view 需声明 `pageName` 绑定,校验目标页面存在,渲染委托既有页面渲染器

**Zero new authorization surface, as the ruling's basis requires.** Nothing in
this change touches a metadata type's `allowOrgOverride` / `allowRuntimeCreate`
flags, adds a write door, or adds a read door. A `page` view is a `view` written
through the door `view` already opens, and it holds a NAME — the page itself is
still fetched through the page read path it already had, and still renders
through the existing page renderer, so the page's own audience gate
(`page.assignedProfiles`) rides along unchanged. Delegation is what preserves
that: a second renderer is what would have introduced a second gate.

**The binding, refused in both directions at parse.** `ListViewSchema` gains
`pageName`, declared with `SnakeCaseIdentifierSchema` — the same grammar
`PageSchema.name` carries, so the accepted set is exactly the set of strings that
could name a page. `checkListViewPageMount` then refuses:

- `type: 'page'` with no `pageName` — unlike every other view type there is no
  degraded rendering to fall back to, so the view would be blank;
- `pageName` on any other view type — the accepted-and-ignored shape;
- a non-empty `columns` beside a page mount — `columns` is the one required key
  on a list view, and the only truthful value for a page mount is `[]`.

The check is attached at all three list-view doors (`ListViewSchema`,
`ObjectListViewSchema`, and the flattened runtime overlay behind
`PUT /api/v1/meta/view`), with a pinned test that fails if any attachment is
dropped.

**Existence of the target page** is answered where the collection is visible:
`defineStack`'s `validateCrossReferences` refuses at build time (same
`pageNames.size > 0` policy the two other page references in that function
already use), and the new `@objectstack/lint` rule `view-page-unresolved`
(`validateViewPageRefs`) resolves it on `os validate` / `os lint` / `os compile`
**and** at the runtime publish gate. Advisory, not gating, for its nav twin's
reason: with no curated cross-package page registry, "unresolved here" cannot be
told apart from "provided by a package this stack cannot see".

Reaching the runtime publish gate needed the per-write snapshot to carry the
`pages` collection (`RuntimeStackContext.pages`, threaded through
`evaluateRuntimeAuthoringGate` and read off the live registry in
`saveMetaItem`'s gate call). That is the one-key widening `RuntimeStackContext`
documents, made when a rule that reads the collection crossed the wall — never
in advance — and the false-positive channel it closes is measured both ways in
`runtime-gate.view-page-refs.test.ts`. `pages` joined `NAME_KEYED_STACK_KEYS` in
the same edit, because a collection that is both context-filled and
write-targeted must have its finding paths name-keyed (#10064).

**Downstream note (not an accept-set narrowing).** No previously valid metadata
becomes invalid: `pageName` is a new key and `page` a new enum member, so every
refusal above can only fire on a document that could not be written before.
What does change for a downstream schema author is composition: `ListViewSchema`
now carries a refinement, and zod 4 refuses `.omit()` / key-overwriting
`.extend()` on a refined object. The unrefined shape stays module-private
(publishing it would mint a duplicate protocol def and a second full set of
ratcheted authorable-surface keys), so a consumer that derived from
`ListViewSchema` by omission should compose with `.safeExtend()` or narrow after
parsing. `FormViewSchema` has had this property since its own refinement landed,
so this is the established shape for view schemas rather than a new one.

**Deliberately out of scope**, per the same ruling: 方向 2 (registering app
navigation at publish time) is deferred to its own design card — it would
require reversing the `app.allowOrgOverride: false` authorization decision — and
with it the known limitation the ruling accepts on the record, that a page
belonging to no object still has no browse-to entry. `page` is also NOT added to
`VisualizationTypeSchema`: the switcher offers alternative ways to draw the same
rows, and a page draws none.
