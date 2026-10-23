---
"@objectstack/console": patch
---

Console (objectui) refreshed to `1d178e06ac5e`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 6 releasing of 6 changesets added across 5 non-merge commits.

- **minor** — Setup → Positions now says who holds each position and which permission sets it grants, and a click anywhere on a row opens the item (objectstack#25333). (objectui `a14737b14`)
- **patch** — types: a node derived from an `@objectstack/spec` schema keeps the spec's `credential` registry key (`'value' | 'map'`, objectstack#25036, which marks the webhook's `secret` and `… (objectui `1d178e06a`)
- **patch** — dashboard: a dataset chart draws its null bucket under the name the dataset declares for it (`fields[].nullLabel`, the dimension's `nullLabel` resolved by the server), over the gl… (objectui `1d178e06a`)
- **patch** — Setup's Permission Sets and Positions lists ask before the Active switch turns an item off, and a toast confirms the change either way (objectui#13338). (objectui `fcbf1b280`)
- **patch** — A member who may read none of the objects an app names now lands on one page that says they need access and whom to ask, instead of the app's dashboard drawn as a grid of "You don… (objectui `2c4e5f5af`)
- **patch** — A single-series bar chart draws every bar in its series colour (objectstack#25330). (objectui `56b65c0ce`)

Metadata-protocol: none (the console refresh changes no key, value or type a metadata author writes)

objectui range: `5fef032b1ada...1d178e06ac5e`
