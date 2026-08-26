---
"@objectstack/objectql": patch
---

fix(objectql): the flat-input Proxy mirrors `data`'s own descriptor instead of synthesising one (#12397)

`installFlatInput` hands a declarative hook a flat-record Proxy over the
engine's `{ data, options, id? }` wrapper. Its `getOwnPropertyDescriptor` trap
answered every key `data` carries with one fixed literal —
`{ configurable: true, enumerable: true, writable: true, value: data[prop] }` —
and never read `data`'s real descriptor. For a key created by ordinary
assignment that synthesis is the truth, which is why it cost nothing for as
long as assignment was the only way a key could arrive.

#12277 routed `defineProperty` into `data`, so a hook can now put a key on the
record payload with non-default attributes for the first time, and the
synthesis reported the defaults back regardless:

```js
Object.defineProperty(ctx.input, 'k', { value: 1, enumerable: false, configurable: true });
Object.getOwnPropertyDescriptor(ctx.input, 'k');  // reported enumerable: true — it is not
Object.keys(ctx.input);                           // …while this correctly omitted 'k'
```

Two instruments over one payload, contradicting each other. The trap now
mirrors `data`'s own descriptor.

`configurable` is the one attribute that cannot be mirrored: the proxy target
is the wrapper, which does not carry the record key, and a proxy may not report
a property its target lacks as non-configurable — a verbatim mirror throws
`TypeError` on any key `data` holds as `configurable: false`, and takes
`Object.keys` and spread down with it, since both reach every listed key
through this trap. It is forced `true`; `enumerable` / `writable` are mirrored.

Two further observable consequences, both pinned:

- Reading a descriptor no longer runs author code. The synthesis evaluated
  `data[prop]` to fill `value`, so asking a payload that holds an accessor for
  its descriptor invoked the getter; a mirror copies `get`/`set` across
  untouched.
- `prop in data` is true for the whole prototype chain, so the synthesis
  answered for inherited keys too — `Object.getOwnPropertyDescriptor(input,
  'toString')` returned an own, enumerable, writable data property no payload
  has ever held, and `Object.hasOwn(input, 'toString')` was `true`. Only an own
  key has a descriptor to mirror; inherited keys now report `undefined`, while
  `'toString' in input` and the read itself are unchanged.

Enumeration is untouched: `ownKeys` still lists exactly `data`'s own enumerable
keys and the mirror reports those as enumerable, so `Object.keys`, spread,
`Object.entries` and the sandbox's `unwrapProxyToPlain` see byte-identical
results. What a record payload may hold, how `defineProperty` routes into
`data`, and how the engine persists it are all untouched.
