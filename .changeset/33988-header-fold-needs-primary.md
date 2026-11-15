---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): a list page with no declared primary action keeps its header actions as buttons, whatever the length of the object's description

Clause-②: no
Metadata-protocol: none

On a list page the header folds its actions when they do not fit beside the title and the object's description: the primary action stays a labelled button and the others move into the `⋯` menu. The primary is declared: the page's New, else the list-toolbar action authored `variant: 'primary'`. A list with neither had nothing to keep labelled, so the folded header was the `⋯` alone, and a long description by itself moved the page's one action (for example a reader without create rights and a single `Launch Contract` toolbar action) into the menu at desktop width. Such a list is now offered no folded header: its actions stay buttons at every width and the description is truncated instead. The `/data` page follows the same rule: with no New to keep, Save as view stays a button. A list that declares a primary folds exactly as before. To keep a toolbar action labelled on a narrow header as well, author it `variant: 'primary'`.
