---
'@objectstack/service-storage': minor
---

fix(service-storage)!: downloading a file with no attachments scope and no field owner requires a signed-in caller

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A runtime authorization narrowing at the two storage download routes, not a metadata change: no spec key, export, option, response field or stored shape is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which callers those routes serve for one file class: a caller with no session is now refused a file that has neither an attachments scope nor a field owner, while a signed-in caller is served as before. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers these routes and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The storage download routes, both the one that answers a signed URL and the stable one that redirects to the bytes, now require a signed-in caller for a file that has neither an attachments scope nor a field owner: an upload no record has claimed. That is the class an avatar or an organization logo stored as a URL belongs to, and so is a picked file not yet saved to its record. ADR-0104 made the anonymous capability URL an opt-in, `acl: 'public_read'`; this was the one class still served anonymously by default.

- **Refused now:** a caller with no session, with `401 AUTH_REQUIRED`, the answer the upload routes and the attachments gate already give an unauthenticated caller. No signed URL is minted for the refused caller.
- **Unchanged:** a signed-in caller is served exactly as before, including the signed URL's lifetime. A browser's `<img src>` and `<a href>` send the session cookie the sign-in set, so a signed-in page keeps rendering these files. A file marked `acl: 'public_read'` stays anonymous. Attachments-scope and field-owned files keep their parent-record verdicts. A deployment with no `auth` service, whose storage routes run without a session resolver, keeps these downloads open as before and says so once in its log.

What changes for you. Before this release, anyone holding such a file's id could download it; now, sign in first. A file that must render before sign-in (on a sign-in page, in an email, on a public page) needs `acl: 'public_read'` on its `sys_file` row.
