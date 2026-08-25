---
"@objectstack/service-analytics": patch
---

The ObjectQL analytics strategy now refuses a custom-SQL measure (`AggregationMetricType` `number` / `string` / `boolean`) with a loud `400 INVALID_FIELD` naming the measure and its metric type, instead of forwarding the raw SQL expression into `engine.aggregate` — where `driver-sql` rejected it blaming a `function` key the author never wrote, and the in-memory evaluator silently answered `null` for every bucket under the measure's own name.

What stops being served, and for whom: on deployments whose driver has no native SQL capability (the ObjectQL aggregate path — e.g. Mongo or in-memory), a query or dataset widget selecting a custom-SQL measure now answers a 400 that says to use an aggregate measure (count/sum/avg/min/max/count_distinct) or run the cube on a native-SQL driver. Those queries previously "succeeded" with a per-bucket `null` (or a mis-attributed driver error), never with a correct number. Native-SQL driver behaviour is unchanged: custom-SQL measures still run there, emitted verbatim.
