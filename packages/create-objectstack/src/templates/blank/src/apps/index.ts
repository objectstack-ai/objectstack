// The apps in this directory. A package whose manifest type is 'app'
// holds at most one app: `objectstack generate app NAME` writes it here while
// there is none, and adds its export line below. Once there is one, put another
// object in the Console by adding a navigation entry for it to that app (a
// 'group' entry with children nests them) rather than a second app, or replace
// that app. objectstack.config.ts hands every export of this file to the stack,
// so an app exported here is part of it, and an app file this index does not
// export is never loaded.
export {};
export { default as main } from './main.app';
