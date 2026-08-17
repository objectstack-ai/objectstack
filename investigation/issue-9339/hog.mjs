const end = Date.now() + Number(process.argv[2]||300)*1000;
while (Date.now() < end) { let x=0; for(let i=0;i<5e6;i++) x+=i; }
