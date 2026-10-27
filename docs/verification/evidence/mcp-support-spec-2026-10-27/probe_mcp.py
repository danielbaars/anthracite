#!/usr/bin/env python3
"""Read-only MCP reconnaissance; no tools that change repository state."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import select
import subprocess
import threading
import time


def digest_text(text):
    data = text.encode("utf-8")
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gt", required=True)
    parser.add_argument("--an", required=True)
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    root = Path(args.root)
    root.mkdir(parents=True, exist_ok=False)
    cwd = root / "empty-project"
    cwd.mkdir()
    config = root / "config" / "graphite"
    config.mkdir(parents=True)
    (config / "user_config").write_text(json.dumps({"updateAutomatically": False, "promptForUpdates": False}))
    env = dict(os.environ, XDG_CONFIG_HOME=str(root / "config"), GH_CONFIG_DIR=str(root / "gh-config"), NO_COLOR="1", CI="1")
    env.pop("GH_TOKEN", None)
    env.pop("GITHUB_TOKEN", None)
    proc = subprocess.Popen([args.gt, "mcp", "--no-interactive"], cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    diagnostics = bytearray()

    def drain():
        while True:
            block = proc.stderr.read(4096)
            if not block:
                return
            if len(diagnostics) < 65536:
                diagnostics.extend(block[:65536 - len(diagnostics)])

    reader = threading.Thread(target=drain, daemon=True)
    reader.start()

    def send(message):
        proc.stdin.write((json.dumps(message) + "\n").encode())
        proc.stdin.flush()

    def request(identifier, method, params):
        send({"jsonrpc": "2.0", "id": identifier, "method": method, "params": params})
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if not select.select([proc.stdout], [], [], 0.1)[0]:
                if proc.poll() is not None:
                    raise RuntimeError("MCP server exited before its response")
                continue
            line = proc.stdout.readline()
            if not line:
                raise RuntimeError("MCP stdout closed before its response")
            message = json.loads(line)
            if message.get("id") == identifier:
                return message
        raise RuntimeError("MCP response timed out")

    report = {"gtExecutable": args.gt, "gtSha256": hashlib.sha256(Path(args.gt).read_bytes()).hexdigest(), "transport": "stdio", "requests": []}
    try:
        hello = request(1, "initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "anthracite-spec-probe", "version": "0.1"}})
        report["initialize"] = hello
        send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        tools = request(2, "tools/list", {})["result"]["tools"]
        report["tools"] = [{"name": tool["name"], "required": tool["inputSchema"].get("required", []), "properties": {name: {key: value for key, value in schema.items() if key != "description"} for name, schema in tool["inputSchema"].get("properties", {}).items()}, "descriptionDigest": digest_text(tool.get("description", ""))} for tool in tools]
        learned = request(3, "tools/call", {"name": "learn_gt", "arguments": {}})
        report["learn"] = {"resultKeys": list(learned.get("result", {}).keys()), "contents": [{"type": item["type"], **digest_text(item.get("text", ""))} for item in learned.get("result", {}).get("content", [])], "error": learned.get("error")}
        for identifier, command, why in [(4, ["--version"], "Read version without a repository."), (5, ["info", "anthracite-mcp-nonexistent", "--no-interactive"], "Observe a genuine repository-context error."), (6, ["--version"], "Read version after a command error.")]:
            result = request(identifier, "tools/call", {"name": "run_gt_cmd", "arguments": {"args": command, "cwd": str(cwd), "why": why}})
            report["requests"].append({"id": identifier, "args": command, "response": result})
        direct = subprocess.run([args.gt, "info", "anthracite-mcp-nonexistent", "--no-interactive"], cwd=cwd, env=env, capture_output=True, text=True, timeout=15)
        report["directFailure"] = {"status": direct.returncode, "stdout": direct.stdout, "stderr": direct.stderr}
        missing = subprocess.run([args.an, "mcp", "--no-interactive"], cwd=cwd, env=env, capture_output=True, text=True, timeout=15)
        report["anthraciteBefore"] = {"version": subprocess.check_output([args.an, "--version"], text=True).strip(), "mcpStatus": missing.returncode, "stdout": missing.stdout, "stderr": missing.stderr}
    finally:
        proc.stdin.close()
        try:
            status = proc.wait(timeout=4)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, 15)
            try:
                status = proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, 9)
                status = proc.wait()
        reader.join(timeout=1)
        report["serverExit"] = status
        report["serverStderrDigest"] = {"bytes": len(diagnostics), "sha256": hashlib.sha256(diagnostics).hexdigest()}
    (root / "receipt.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, separators=(",", ":")))


if __name__ == "__main__":
    main()
