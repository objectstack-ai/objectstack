---
'@object-ui/app-shell': patch
---

fix(app-shell): a marketplace package's README fits its detail page; badges render as images and pipe tables as tables

Clause-②: no
Metadata-protocol: none

On a package's detail page below the `lg` breakpoint, one long line in a README code block widened the whole README past the page's right edge, where it was cut off with no way to scroll: the page's grid cells took their content's width as their minimum. Each cell now may shrink to the page, so long words wrap and only a code block or a table scrolls, inside itself.

The README renderer also reads three things it printed as literal markup:

- Images, `![alt](src)` and linked `[![alt](src)](href)` badges, render from an absolute `https:` URL, without sending the console's address as referrer. Any other source (a repository-relative path such as `LICENSE`, `http:`, `data:`, `javascript:`) is left out, alt text included. A linked image keeps its link only for an absolute `http:` or `https:` destination.
- GFM pipe tables render as tables, with the delimiter row's alignment, each in its own horizontal scroller.
- Thematic breaks (`---`, `***`, `___`) between blocks render as a rule.

Everything else renders as before; release notes in the Versions panel go through the same renderer.
