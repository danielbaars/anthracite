import os,pty,select,time,json,sys,fcntl,termios,struct
from fixture import ROOT,TOOLS,env_for,snapshot
CASES={'interactive-default':'\r','interactive-one':'\x1b[B \r','interactive-all':'\r','interactive-none':' \x1b[B \r','frozen':'\x1b[B \r','occupied':'\x1b[B \r','interactive-confirmed':'\r','minimum-one':' \x1b[B \r','cancel-confirmed':'\x03','onto-select':'\x1b[B \r','frozen-select':'\x1b[B \r','occupied-select':'\x1b[B \r'}
def execute(case,tool):
 f=ROOT/(case+'-'+tool)
 args=TOOLS[tool]+['create','inserted','--insert','-m','Inserted work']
 if case=='onto-select':args+=['--onto','parent']
 pid,fd=pty.fork()
 if pid==0:
  os.chdir(f/'repo');os.execvpe(args[0],args,env_for(f))
 fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',32,110,0,0))
 raw=b'';frames=[];events=[];start=time.monotonic();sent=False;status=None;cancelled=False
 while time.monotonic()-start<60:
  elapsed=time.monotonic()-start
  ready,_,_=select.select([fd],[],[],0.05)
  if ready:
   try:data=os.read(fd,65536)
   except OSError:data=b''
   if data:raw+=data;frames.append({'at_ms':round(elapsed*1000),'data':data.decode('utf8','replace')})
  if not sent and b'Which branches would you like to move onto' in raw and elapsed>.7:
   os.write(fd,CASES[case].encode());events.append({'at_ms':round(elapsed*1000),'data':CASES[case]});sent=True
  if case=='minimum-one' and b'You must select a minimum of 1 choices' in raw and not cancelled:
   os.write(fd,b'\x03');cancelled=True
  done,s=os.waitpid(pid,os.WNOHANG)
  if done:status=s;break
 if status is None:
  os.kill(pid,15);_,status=os.waitpid(pid,0)
 os.close(fd)
 result=dict(args=args,exit=os.waitstatus_to_exitcode(status),frames=frames,events=events,promptObserved=b'Which branches would you like to move onto' in raw,output=raw.decode('utf8','replace'),timeout=time.monotonic()-start>=60)
 (f/'interactive-execution.json').write_text(json.dumps(result,indent=2)+'\n');(f/'after-interactive.json').write_text(json.dumps(snapshot(f),indent=2)+'\n'); print(case+'-'+tool, result['exit'],result['promptObserved'],repr(result['output'][-650:]),flush=True)
for case in sys.argv[1:] or ['interactive-default','interactive-one','interactive-all','interactive-none']:
 for tool in (['an'] if case=='interactive-confirmed' else ['gt']):execute(case,tool)
