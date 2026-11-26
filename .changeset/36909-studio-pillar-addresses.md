---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(studio): every old Studio address still opens what it named, now in one redirect

Clause-②: no
Metadata-protocol: none

Studio no longer has pillars (Data, Automations, Access, Interfaces): objects, flows and permission sets open their designers full-screen on their own addresses. The old pillar addresses are bookmarks, links an AI was handed and the server's draft review link, so each still lands on the page that replaced it:

- `/studio/<package>` and `/studio/<package>/data` open the package's object list; `/data?surface=object:<name>` opens that object's designer, and `/data?changes=review` opens the object list with the Changes drawer.
- `/studio/<package>/automations` opens the flow list; with `?surface=flow:<name>`, that flow's designer.
- `/studio/<package>/access` opens the permission set list; with `?surface=permission:<name>`, that set's matrix; with `?surface=owd:overview`, the default sharing overview.
- `/studio/<package>/interfaces` opens the object list and says where interface editing went.
- `/studio/~org` and every `/studio/~org/...` address open the organization's own flows.

Each of these now arrives in one redirect. Before, `/data` passed through two (`/studio/<package>` through three) before the page settled. The "Open Access" button on a publish toast opens the package's permission sets, and the Changes sheet's link to a permission set opens that set's page, directly.

Removed internals of `@object-ui/app-shell` that nothing read any more: `STUDIO_ORG_SCOPE_PILLAR`, `STUDIO_HOME_PILLAR` (from the package entry), `AREA_PILLAR_FOR_TYPE`, `areaItemPillarPath`, `STUDIO_ITEM_PILLAR`, `studioItemPillar`, `studioPillarItemAddress`, `studioSurfaceQuery`, the `?surface=` capture and mirror hooks (`useSurfaceDeepLink` and its halves, `parseSurfaceTarget`, `resolveSurfaceDeepLink`) and `useRequestedSurface`. The package is private, so nothing published changes shape. A host that declares the `/studio` routes mounts the new `StudioPillarRedirect` on `:packageId` and `:packageId/:tab`.
