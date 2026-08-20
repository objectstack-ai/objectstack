---
"@objectstack/spec": patch
---

docs(spec): record the live read point of `page:tabs` `items[].icon` — a `.describe()` plus an accept-pin, the exact sibling of the accordion record (#9972)

`PageTabsProps.items[].icon` parsed, rendered, and said nothing about itself —
the same state `page:accordion`'s item `icon` was in one component over. That
absence is what a liveness sweep reads as declared-but-unenforced: a retirement
candidate was opened against the accordion key, and a full dispatch cycle went
into re-deriving the cross-repo read point before the candidate was closed
premise-overtaken. Recording the accordion's liveness left the identical
absence on the tab item, from which the same false candidate is still derivable.

**The key is live**, re-verified at the objectui pin this repo builds against
(`.objectui-sha` = `82a94170c`) rather than taken from the card:

- `packages/components/src/renderers/layout/containers.tsx:662-665` —
  `PageTabsRenderer` renders `{item.icon && <LazyIcon name={item.icon} …/>}`
  inside the `TabsTrigger`, left of the label span.
- `containers.tsx:721` — `ComponentRegistry.register('tabs', …)` publishes the
  key to the Studio block designer in the `items` input, documented as
  `[{ label, value?, icon?, count?, visibleWhen?, children }]`.

**Nothing about what parses changes.** The key was already declared and already
optional; this adds the prose that makes its liveness readable, and the test that
keeps it readable:

- a `.describe()` naming the consumer behaviourally, in the file's house idiom —
  the same shape the landed accordion describe uses ("Read on this component —
  contrast …"), with the file:line anchors and the measured pin in the docblock
  above the key, where this file keeps them;
- an accept-pin asserting the key parses on a `page:tabs` item and survives to
  the parsed output, that an undeclared sibling on the same item is still refused
  (so the accept is not vacuous on a schema that stopped being strict), and that
  the `.describe()` still names the consumer — deleting it is what re-opens the
  false candidate, so it is pinned rather than left to review.

The item `key` prescribed against in the same shape's alias table is the
deliberate contrast: that spelling reaches no read point at all, and a read point
is precisely what separates the two verdicts.
