---
'@objectstack/service-automation': patch
---

fix(service-automation): a screen-flow resume refuses a non-string value for a text-like field before the pause is consumed

Clause-②: no (narrowing)
Metadata-protocol: none

Ruling A+ (#31491): `text`, `textarea`, `email`, `url` and `phone` join the screen-input value domains on one predicate, a JSON string. A resume that sends an object, a number, a boolean or an array under one of those fields is refused `400 INVALID_SCREEN_INPUT` (`invalid_type`, "must be a string") before the suspension is consumed, so the run stays paused and a corrected resume completes it. Before this, an object reached the record write after the pause was gone, the run failed and a corrected resume answered `RUN_NOT_FOUND`; a number was stored as text. Only the shape is judged: the format of an email, URL or phone number, and any other refusal of a string downstream, are unchanged. A headless (MCP `run_action`) caller that supplies a non-string for such a field has not answered the screen, so the screen stays interactive, as it already does for a non-number on a numeric field.
