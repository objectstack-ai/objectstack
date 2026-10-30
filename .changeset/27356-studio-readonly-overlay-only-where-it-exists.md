---
'@object-ui/app-shell': patch
---

fix(studio): a read-only package's item header offers "Customize with an overlay" only for a type that takes one

Clause-②: no
Metadata-protocol: none

In Studio, an item of a read-only (code or installed) package showed "Read-only · Customize with an overlay" in its header on every pillar, including objects, flows, pages and permission sets, none of which take an environment overlay, and the link opened the package's whole metadata directory. Now:

- **An overlay-able item.** When the open item's metadata type declares `allowEnvironmentOverlay` in the server's type registry (today views, dashboards, reports, translations and email templates), the header keeps "Read-only · Customize with an overlay", and it opens that item's own page in Setup (`/apps/setup/metadata/TYPE/NAME`), where the overlay is edited.
- **Anything else.** An item whose type takes no overlay, a header with no item open, or a registry not yet read shows a plain "Read-only" with a lock. It is no longer a link. Its tooltip still carries the pillar's read-only sentence.
