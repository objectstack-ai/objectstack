---
'@object-ui/console': patch
---

fix(console): a public-form submit the browser blocks no longer leaves the previous attempt's banner on screen

Clause-②: no
Metadata-protocol: none

A control the browser judges invalid, such as a malformed address in an `email` row, stops the submit before the page's own submit handler runs, so the banner kept the previous attempt's text: "Required: Name, Email, Message" after all three were filled. The page now judges a blocked attempt again with its own checks over the rows the submit would judge: when they refuse something the banner names it, otherwise the banner clears. Each control the browser refused is marked with the browser's own message. Native format validation is kept, and a server refusal still shows its banner.
