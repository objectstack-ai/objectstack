---
'@objectstack/service-print': patch
---

fix(service-print): a server print works under the console's default Content Security Policy

Clause-②: no
Metadata-protocol: none

Every server print (`POST /api/v1/print/records`, `printRecordToFile`) failed on a deployment that keeps the console's default CSP, answering "The print engine failed … page.waitForFunction: EvalError: Evaluating a string as JavaScript violates the following Content Security Policy directive". The Chromium driver waited for the print page with a string predicate, which playwright-core evaluates with `eval` in the page on every poll; the console's `script-src` carries no `'unsafe-eval'` unless `OS_PAGE_REACT_ENABLED` is on, so the second poll was refused.

The driver now hands the wait a function predicate. playwright-core evaluates a function's text once, inside the DevTools call that starts the wait, which the page's CSP does not govern, and each poll calls the function it produced. The wait means exactly what it meant: a root carrying `data-print-page` and an idle console (`window.__objectui.idle`), held for three polls in a row, polled every 100 ms within the render's one budget. The console CSP is unchanged.
