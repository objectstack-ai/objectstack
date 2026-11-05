---
'@objectstack/service-storage': patch
---

fix(service-storage): Setup → Storage → Test connection answers in the caller's language

Clause-②: no
Metadata-protocol: none

The `storage/test` settings action writes its `message` in the language the settings action route hands its handler as `locale` (`Accept-Language`, else `?locale`), the same source the mail test notice reads. It covers the sentences the product writes: the success sentence (which still names the adapter), the refusal when the probe read back is not the one written, and the refusal for S3 settings missing a bucket or a region. An adapter's own error text stays verbatim: alone in English, as before; in another language behind a lead-in saying the connection test failed. Locales: `en`, `zh-CN`, `ja-JP`, `es-ES`; an absent locale, or one with no copy, is answered in English exactly as before. `ok`, `severity`, the probe and its cleanup, and the operator log lines are unchanged.
