---
'@object-ui/app-shell': patch
---

fix(app-shell): a related-record form the URL opens over a record drawer stays on top after a reload

Clause-②: no
Metadata-protocol: none

Opening New from a related list in a record drawer puts the form in the URL (`?recordId=…&form=new&formObject=…&formLink=…`). Reloading that URL, or opening it from a shared link, drew the form first and the drawer a moment later, so the drawer's panel covered the right half of the form and its Create button, and `Esc` closed the drawer instead of the form. The console now opens such a form only once the page under it is shown and the record drawer it names is drawn, so it stacks above the drawer and answers `Esc` first, exactly as when it is opened by a click. A form already open is never closed by a drawer that opens later, and a form whose page draws no drawer opens as soon as its page is shown (not over the page's loading skeleton).
