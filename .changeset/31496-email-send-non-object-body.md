---
'@objectstack/rest': patch
---

fix(rest): `POST /api/v1/email/send` refuses a JSON array or `null` body with its own `400 INVALID_REQUEST` before the email service is reached

Clause-②: no
Metadata-protocol: none

The send door's body check read `typeof body !== 'object'`, which an array passes, and it defaulted a JSON `null` body to `{}`. Either way the message reached the email service, which refused it as a malformed message (`400 VALIDATION_FAILED`, "subject is required"). The door now admits a present body only when it is a plain JSON object, so an array or `null` gets the same `400 INVALID_REQUEST` ("JSON body required") as a string or a number, and the service is never called. A request with no body is still the empty message for the service to judge, and every object body is forwarded exactly as before. Both kinds of body were refused with a 400 before this change and are refused with a 400 after it; only the code changes, from the service's `VALIDATION_FAILED` to the route's `INVALID_REQUEST`.
