import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
// 1) coarse-clock granularity of directory mtime on this fs
const d = await fs.mkdtemp(path.join(os.tmpdir(),'gran-'));
const ms = [];
for (let i=0;i<4000;i++){ await fs.writeFile(path.join(d,'f'+i),'x'); ms.push((await fs.stat(d)).mtimeMs); }
const deltas=[...new Set(ms.map((v,i)=>i?Math.round((v-ms[i-1])*1000)/1000:0).filter(x=>x>0))].sort((a,b)=>a-b);
console.log('distinct mtime values among 4000 rapid dir mutations:', new Set(ms).size);
console.log('smallest nonzero mtime deltas (ms):', deltas.slice(0,8));
const ties = ms.filter((v,i)=>i&&v===ms[i-1]).length;
console.log('consecutive ties:', ties, '/', ms.length-1);
await fs.rm(d,{recursive:true,force:true});
