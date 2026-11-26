// The objects in this directory. `objectstack generate object NAME` writes one
// here and adds its export line below. objectstack.config.ts hands every
// export of this file to the stack, so an object exported here is part of it,
// and an object file this index does not export is never loaded.
export { Company } from './company.object.js';
export { Contact } from './contact.object.js';
