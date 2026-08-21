---
"@objectstack/spec": minor
---

Add `nameField` to the solution-blueprint strict mirror's object schema (required-but-nullable, matching the strict convention), so the design-stage structured output can author the ADR-0079 record-title choice instead of always deferring to the platform auto-pick. The key-parity pin between the strict mirror and the lenient schema is widened from the field schemas to the object schemas, so the next object-level divergence fails a test.
