---
'@object-ui/app-shell': patch
---

fix(app-shell): a console rendered inside a frame (the Live Canvas preview) no longer opens a second assistant dock from the host page's state

Clause-②: no
Metadata-protocol: none

The Live Canvas shows the app in an iframe of the full console. That frame shares the tab's sessionStorage, so it read the host page's `ai-chat-dock-expanded` flag and mounted its own assistant dock beside the host's. At 1024 px the two 420 px rails left the app's list about 200 px wide.

What changes:

- A console inside a frame (`window.self !== window.top`) ignores the stored dock flag and starts with its dock collapsed. The assistant launcher stays, so the dock is still one click away inside the preview.
- Opening or closing the dock inside the frame keeps that state in the frame only. It no longer writes the host page's flag, so the host's dock is unchanged when the preview closes.
- A top-level console page, including a preview opened in its own tab, keeps the dock exactly as before.
