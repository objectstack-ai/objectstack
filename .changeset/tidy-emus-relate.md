---
'@objectstack/service-datasource': patch
---

`os datasource introspect` now generates the authorised `*.object.ts` shape

The Object draft rendered by `generateObjectDraft` (and served by
`POST /api/v1/datasources/:name/external/tables/:remote/draft`) used the
annotated-object-literal form. The director-seat ruling of 2026-09-12 (decision
batch #122 item 1) makes `ObjectSchema.create({ … })` the one authorised shape
for a `*.object.ts`, and the draft is destined for a committed `*.object.ts` —
the command's own `--out objects/wh_order.object.ts` example says so. Drafts
generated before this release were therefore written in the shape the platform
refuses.

FROM → TO, for a draft you already committed — one mechanical rewrite:

```ts
// FROM
import type { ServiceObject } from '@objectstack/spec/data';

const wh_order: ServiceObject = {
  name: 'wh_order',
  // …
};

export default wh_order;

// TO
import { ObjectSchema } from '@objectstack/spec/data';

export const wh_order = ObjectSchema.create({
  name: 'wh_order',
  // …
});
```

Two things change beyond the wrapper. The spec import is now a **value**
import, because the factory runs when the file is evaluated — an `import type`
would be elided and the module would throw on its own first line. And the
export is **named only**: the `export default` is gone, matching the barrel the
scaffolder writes (`export { X } from './x.object.js'`). A barrel that imported
the draft as a default (`import X from './x.object.js'`) becomes
`import { X } from './x.object.js'`.

Regenerating the draft is the other route: re-run
`os datasource introspect <datasource> --table <remote> --out <path>`.

The two authored comment blocks the draft carries — the remote-primary-key note
and the ADR-0028 unprefixed-name TODO — are unchanged.

Clause-②: no
