import { spawnSync } from 'child_process';

const ptyRunner = `
import errno, json, os, pty, select, signal, subprocess, sys, time
command = json.loads(sys.argv[1])
responses = json.loads(sys.argv[2])
response_offset = 0
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
                while responses:
                    prompt = responses[0]['prompt'].encode()
                    found = output.find(prompt, response_offset)
                    if found >= 0:
                        response = responses.pop(0)
                        if 'beforeInput' in response:
                            subprocess.run(response['beforeInput'], check=True)
                        os.write(fd, response['input'].encode())
                        response_offset = found + len(prompt)
                    else:
                        break
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
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly responses?: readonly {
      readonly prompt: string;
      readonly input: string;
      readonly beforeInput?: readonly string[];
    }[];
  }
): { status: number | null; output: string } {
  const result = spawnSync(
    '/usr/bin/python3',
    [
      '-c',
      ptyRunner,
      JSON.stringify(command),
      JSON.stringify(options.responses ?? []),
    ],
    { ...options, encoding: 'utf8', timeout: 10000 }
  );
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}
