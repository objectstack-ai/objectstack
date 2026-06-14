---
---

chore(services): remove BullMQ vaporware + reframe cluster packages Redis-first → Redis-free. Deletes a throw-only `BullMQQueueAdapter` stub (every method raised "not yet implemented (M10.43)"; no external consumers) and corrects misleading docs in service-queue/service-cluster/service-cluster-redis. No functional change to any working code path — empty changeset, no package version impact.
