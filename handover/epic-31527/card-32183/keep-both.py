import sys,re
p=sys.argv[1]; s=open(p).read()
m=re.search(r'<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> origin/main\n(    \}\);\n\}\);\n)', s, re.S)
assert m and s.count('<<<<<<<')==1
ours,theirs,tail=m.group(1),m.group(2),m.group(3)
s=s[:m.start()]+ours+tail+'\n/**\n'+theirs+tail+s[m.end():]
open(p,'w').write(s)
