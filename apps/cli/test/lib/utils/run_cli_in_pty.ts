import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ptyRunner = `
import errno, json, os, pty, select, signal, subprocess, sys, time
command = json.loads(sys.argv[1])
responses = json.loads(sys.argv[2])
response_offset = 0
pid, fd = pty.fork()
if pid == 0:
    os.execv(command[0], command)
output = bytearray()
deadline = time.monotonic() + float(sys.argv[3])
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
    readonly timeoutMs?: number;
    readonly responses?: readonly {
      readonly prompt: string;
      readonly input: string;
      readonly beforeInput?: readonly string[];
    }[];
  }
): {
  status: number | null;
  output: string;
  outputBase64: string;
} {
  const result = spawnSync(
    '/usr/bin/python3',
    [
      '-c',
      ptyRunner,
      JSON.stringify(command),
      JSON.stringify(options.responses ?? []),
      String((options.timeoutMs ?? 20000) / 1000),
    ],
    { ...options, timeout: (options.timeoutMs ?? 20000) + 5000 }
  );
  if (result.error) throw result.error;
  const output = Buffer.concat([result.stdout, result.stderr]);
  const transcript = {
    status: result.status,
    output: output.toString('utf8'),
    outputBase64: output.toString('base64'),
  };
  const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
  if (evidence) {
    fs.mkdirSync(evidence, { recursive: true });
    fs.appendFileSync(
      path.join(evidence, 'public-cli-pty.jsonl'),
      JSON.stringify({
        command,
        cwd: options.cwd,
        responses: options.responses ?? [],
        environment: Object.fromEntries(
          [
            'GRAPHITE_INTERACTIVE',
            'GRAPHITE_USER_CONFIG_PATH',
            'GIT_OPTIONAL_LOCKS',
            'CHARCOAL_TEST_BINARY',
            'BUN_BE_BUN',
            'CH_PAGER',
            'CH_EDITOR',
            'GIT_EDITOR',
            'HOME',
            'CODEX_HOME',
            'PATH',
          ].map((key) => [key, options.env[key] ?? null])
        ),
        ...transcript,
      }) + '\n'
    );
  }
  return transcript;
}
