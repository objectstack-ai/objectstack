---
"@objectstack/spec": patch
---

docs(spec): record the live read points of `element:button.icon` and `object-metric.icon` — the last two icon slots whose describes stated only the vocabulary (#10053)

Both keys parsed and rendered while saying only what alphabet their value is
drawn from: `Icon name (Lucide icon)` and `Icon name (Lucide)`. That sentence is
equally true of the `page:header` `icon` retired in #6946 — refused *precisely
because no render path reads it* — so the prose could not separate a live key
from a dead one. It is the same absence that sent #9397 through a full dispatch
cycle re-deriving the accordion read point from scratch before the retirement
candidate was closed premise-overtaken. #9881 and #9972 recorded the accordion
and tab items; these two close the set for `component.zod.ts`.

**Both are live**, re-measured rather than transcribed from the card. Note the
pin: the earlier records cite `82a94170c`, but `.objectui-sha` moved to
`9a3daf8d3` in #10137, and these were measured there.

- `element:button.icon` — `packages/components/src/renderers/form/button.tsx:44-47`
  resolves `schema.icon`, and `:69` / `:71` draw it either side of the label per
  `iconPosition`, both suppressed while `loading`.
- `object-metric.icon` — `plugin-dashboard/src/index.tsx:161` publishes it as a
  designer input; `ObjectMetricWidget.tsx:142` destructures it and forwards it at
  `:474` to `MetricWidget`, which resolves it at `MetricWidget.tsx:312-321` and
  draws it at `:373-382` in the `colorVariant`-tinted square.

**The button is the one authorable icon on this surface that does not go through
`LazyIcon`**, and the docblock now says so, because the two paths are not
interchangeable:

- button: `toPascalCase` (splits on `-` only) → a one-entry rename map
  (`Home` → `House`) → `icons[name]` from `lucide-react`. An unknown name
  resolves to `undefined` and the button renders with **no icon and no
  diagnostic**.
- `LazyIcon` / `getLazyIcon` (`components/src/lib/lazy-icon.tsx:66-92`, the slot
  the metric tile and every container icon use): normalises to kebab-case,
  validates against Lucide's own name list, and degrades an unknown name to the
  `Database` glyph.

So a spelling that draws an icon in a tab trigger can draw nothing on a button —
previously discoverable only by reading two objectui files.

**Nothing about what parses changes.** Both keys were already declared and
already optional; no key is widened, narrowed, retired or renamed. What is added
is the prose that makes each liveness verdict readable from the spec side alone,
and the accept-pins that keep it readable: per key, an accept carried through to
the parsed output, an undeclared-sibling refusal so the accept is not vacuous,
and an assertion that the `.describe()` still names its consumer.
