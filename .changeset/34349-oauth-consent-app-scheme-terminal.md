---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): the OAuth consent page stays finished after Authorize or Deny when the client's redirect is an app scheme

Clause-②: no
Metadata-protocol: none

Desktop and native MCP clients (such as WorkBuddy) register a redirect with their own scheme (`workbuddy://…`). After Authorize, the browser hands that address to the app but keeps the tab where it is. The consent page then put its card back with Authorize and Deny enabled again. A person could not tell that the connection had worked, and a second click sent the already-used request again and showed "Consent failed".

Once the server answers a decision with a redirect, the page now treats the request as finished and never enables the buttons again. For an app-scheme redirect it replaces the consent card with the outcome ("Access granted" or "Access denied"). It tells the person to return to the application and that they can close the tab. It also shows an "Open" link to the same redirect, in case the browser's prompt to open the app was dismissed. An `http(s)` redirect, including a loopback one, still navigates the tab away as before. A decision the server refuses still shows the error and enables the buttons again. The new sentences are in every Console language pack.
