---
'@objectstack/sdui-parser': minor
---

html tier: an authored `type=` attribute is now refused at parse time instead of overwriting the component discriminator

On a `kind:'html'` page the tag name **is** the node's `type`, so a `type` attribute is a
name collision with the envelope's own discriminator. The parser now refuses it with one
`forbidden-attr` error naming **both** the tag and the attribute — *Attribute "type" is
not allowed on `<flex>` — on this tier the tag name IS the component…* — replacing two
outcomes, neither good:

- the value named another **registered** type (`<flex type="grid">`): the tree carried the
  author's value as its discriminator, `validateTree` resolved `grid` in the manifest,
  every check passed, and the page rendered a grid where the author wrote a flex — **zero
  diagnostics**, on the one tier whose premise is that unreviewed, AI-authored source is
  safe to accept;
- the value named **nothing** registered (`<object-chart type="bar">`, the shape a
  react-tier author carries across): `unknown-component` naming `"bar"`, which reads as a
  missing plugin rather than as an attribute that should not be there.

Alongside the refusal, `parseElement` builds the node as `{ ...props, type: tag }` rather
than `{ type: tag, ...props }` — defense in depth, and correct only *because* the
attribute is refused loudly: reversing the spread alone would trade a silent overwrite for
a silent discard.

The react tier is unaffected: its `specType` rescue (objectui#2880) stays where it lives
and is deliberately **not** carried over — the two tiers are two source formats, and a
consumer-side alias on a second tier is the tolerance ADR-0080's amendment declined.
`validate.ts`'s `BASE_PROPS` is unchanged (`type` is correct there for every other
member), and no warning grace period is introduced.

**This narrows what the html tier accepts**: a page that compiles today with a `type=`
attribute will be refused. The in-repo migration surface was measured before the change
and is **zero** — no html-tier page source under `content/docs/**` or the example apps
carries one. Maintainer ruling 2026-09-01, recorded as an amendment on ADR-0080.
