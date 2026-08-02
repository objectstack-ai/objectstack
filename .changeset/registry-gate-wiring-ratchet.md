---
---

test(dogfood): pin that the #3770 / #3867 object-existence gates are actually WIRED, not just implemented (#4613). Both gates had unit coverage of the implementation and none of the production wiring: deleting the five lines in `service-analytics/src/plugin.ts` that hand `isRegisteredObject` to the service left the entire repo green (service-analytics 299/299, dogfood 395/395) while `/analytics/query` silently reverted to reading any table the connection can see. The new boot-level gate goes through `bootStack` + real HTTP and reddens on both deletions (3 cases for #3867, 1 for #3770), measured. Test-only; releases nothing.
