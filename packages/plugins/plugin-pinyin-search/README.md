# @objectstack/plugin-pinyin-search

Pinyin search recall: it fills the hidden `__search` companion column with the full pinyin and the initials of a record's display field, so `$search` finds CJK names typed as pinyin. It is locale-gated by `OS_SEARCH_PINYIN_ENABLED`.

```typescript
import { PinyinSearchPlugin } from '@objectstack/plugin-pinyin-search';
```

Documentation: [Queries](https://objectstack.ai/docs/data-modeling/queries)
