import { spawnSync } from 'child_process';

const ptyRunner = `
import errno, json, os, pty, select, signal, sys, time
command = json.loads(sys.argv[1])
pid, fd = pty.fork()
if pid == 0:
    os.execv(command[0], command)
output = bytearray()
deadline = time.monotonic() + 5
status = None
reading = True
while time.monotonic() < deadline:
    if reading and select.select([fd], [], [], 0.05)[0]:
        try:
            chunk = os.read(fd, 65536)
            if chunk:
                output.extend(chunk)
            else:
                reading = False
        except OSError as error:
            if error.errno == errno.EIO:
                reading = False
            else:
                raise
    waited, result = os.waitpid(pid, os.WNOHANG)
    if waited:
        status = result
        break
    if not reading:
        time.sleep(0.01)
if status is None:
    waited, result = os.waitpid(pid, os.WNOHANG)
    if waited:
        status = result
    else:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
sys.stdout.buffer.write(output)
sys.exit(124 if status is None else os.waitstatus_to_exitcode(status))
`;

export function runCliInPty(
  command: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv }
): { status: number | null; output: string } {
  const result = spawnSync(
    '/usr/bin/python3',
    ['-c', ptyRunner, JSON.stringify(command)],
    { ...options, encoding: 'utf8', timeout: 10000 }
  );
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}
