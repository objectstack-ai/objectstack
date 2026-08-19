---
"@objectstack/spec": patch
---

docs(spec): record the live read point of `page:accordion` `items[].icon` — a `.describe()` plus an accept-pin, so a liveness sweep stops re-deriving a false retirement candidate (#9881)

`PageAccordionProps.items[].icon` parsed, rendered, and said nothing about
itself. A liveness sweep therefore read it as declared-but-unenforced and opened
a retirement candidate against it — which cost a full dispatch cycle before the
cross-repo read point was found and the candidate was closed premise-overtaken.
Nothing on the spec side recorded that liveness, so the next sweep would have
derived the same false candidate from the same absence.

**The key is live**, re-verified at the objectui pin this repo builds against
(`.objectui-sha` = `82a94170c`) rather than taken from the card:

- `packages/components/src/renderers/layout/containers.tsx:851-853` —
  `PageAccordionRenderer` renders `{item.icon && <LazyIcon name={item.icon} …/>}`
  inside the `AccordionTrigger`, grouped with the label in the trigger's single
  wrapping span.
- `containers.tsx:898` — `ComponentRegistry.register('accordion', …)` publishes
  the key to the Studio block designer in the `items` input, documented as
  `[{ label, icon?, collapsed?, children }]`.

**Nothing about what parses changes.** The key was already declared and already
optional; this adds the prose that makes its liveness readable, and the test that
keeps it readable:

- a `.describe()` naming the consumer behaviourally, in the file's house idiom —
  the same shape `record:alert`'s own `icon` uses ("Read on this component —
  contrast …"), with the file:line anchors and the measured pin in the docblock
  above the key, where this file keeps them;
- an accept-pin asserting the key parses on a `page:accordion` item and survives
  to the parsed output, that an undeclared sibling on the same item is still
  refused (so the accept is not vacuous on a schema that stopped being strict),
  and that the `.describe()` still names the consumer — deleting it is what
  re-opens the false candidate, so it is pinned rather than left to review.

The item `value` prescribed against one line above is the deliberate contrast:
the same renderer overwrites that key with `panel-<index>`, and a read point is
precisely what separates the two verdicts.
