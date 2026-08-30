import knexLib from 'knex';
const k = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
await k.schema.createTable('p', (t) => { t.text('a'); t.json('b'); t.string('c'); });
console.log('sqlite_master:', (await k.raw("select sql from sqlite_master where name='p'"))[0].sql);
