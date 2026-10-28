---
'@objectstack/spec': minor
---

fix(spec)!: an action's `newTabUrl` is a path on this backend and must start with `/`; an absolute URL is refused at parse

`newTabUrl` is the zero-roundtrip target of the pre-opened-tab flow (`opensInNewTab: true`): on click the console drives the pre-opened tab to the backend origin + `newTabUrl`, with `{recordId}` substituted, and posts nothing. Its JSDoc called it a path template, while its `.describe()` and the action form's help text called it a URL template, and nothing refused an absolute value. So `newTabUrl: 'https://example.com/export/{recordId}'` parsed clean and opened a tab at `https://BACKEND/https://example.com/export/…`. `ActionSchema.newTabUrl` now refuses any value that does not start with `/`, and the JSDoc, `.describe()` and the form help (all four form-translation locales) say the same thing: a path on this backend.

Clause-②: no (narrowing) — `ActionSchema.newTabUrl` (every action door: `defineAction`, the `action` metadata type, an object's `actions[]`) refuses a value that does not start with `/`. Nothing is widened.

Metadata-protocol: narrowed (an action's `newTabUrl` may no longer be an absolute URL or a relative path without a leading `/`)

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: newTabUrl keeps its name, shape and meaning, and now refuses the values that never opened the page they named. No backend path can be derived from an external URL, so there is no mechanical rewrite; a stored action row holding one loads unchanged, is counted invalid with a [metadata_spec_invalid] boot line and still registered, is served with _diagnostics locating newTabUrl, and its next save is refused until the author rewrites it. -->

**BREAKING** accept-set narrowing on `ActionSchema.newTabUrl` (`@objectstack/spec`).

- **Before.** `newTabUrl: 'https://example.com/export/{recordId}'` (or `sso-open/{recordId}`) parsed, and the console opened the backend origin + that text: a broken tab.
- **Now.** The parse refuses it at `newTabUrl` with: `` `newTabUrl` is a path on this backend and must start with `/` `` and names the external-page remedy.
- **Unchanged.** A path template such as `/sso-open/{recordId}` or `/api/v1/invoice/{recordId}/pdf` parses byte-identically. No renderer changes: the console already prefixes the backend origin, so the declared meaning and the behaviour now agree.
- **A row stored before this release.** Nothing converts it. It loads unchanged and is still registered, counted `invalid` with a `[metadata_spec_invalid]` boot line; the metadata read serves it with `_diagnostics` locating `newTabUrl`; it keeps opening the same broken tab; and its next save is refused until the value is a path.
- **Who sees it.** An author who wrote an absolute URL in `newTabUrl`. No example, template, fixture or platform object in this repository does.

**The remedy.** For an endpoint on this backend, write its path: `newTabUrl: '/sso-open/{recordId}'`. For an external page, drop `opensInNewTab` and `newTabUrl` and declare a `type: 'url'` action instead: `target: 'https://example.com/export/${ctx.recordId}'`, `openIn: 'new-tab'`.

Also in `@objectstack/spec`, prose only, no accept-set change:

- The `DashboardWidget` docblock and `requiresObject`'s `.describe()` say that, outside design mode, a dataset-bound widget whose query the server refuses as a read refusal (403 `PERMISSION_DENIED`) is left out of the dashboard for that viewer, and that `requiresObject` stays an install gate, never a viewer gate.
- Three shipped citations of `content/docs/concepts/north-star.mdx` "§8" / "§6.3" (sections that page never had; the page is now `concepts/architecture-overview`) are corrected: `expression.zod.ts` cites ADR-0032 ("one CEL language"), `environment-artifact.zod.ts` cites the architecture overview's "Environment Artifact" section, and `hook-body.zod.ts` drops a pointer to a heading that does not exist. The generated references follow.
