#!/usr/bin/env python3
"""Validate retained specification evidence; does not launch a target."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
manifest = json.loads((root / "manifest.json").read_text())
for name, expected in manifest["files"].items():
    data = (root / name).read_bytes()
    assert len(data) == expected["bytes"], name
    assert hashlib.sha256(data).hexdigest() == expected["sha256"], name

receipt = json.loads((root / "protocol-receipt.json").read_text())
assert receipt["serverExit"] == 0
assert [tool["name"] for tool in receipt["tools"]] == ["run_gt_cmd", "learn_gt"]
assert receipt["tools"][0]["required"] == ["args", "cwd", "why"]
assert receipt["initialize"]["result"]["protocolVersion"] == "2024-11-05"
assert receipt["directFailure"]["status"] == 1
failure = receipt["requests"][1]["response"]["result"]
assert list(failure) == ["content"] and "exited with code 1" in failure["content"][0]["text"]
assert receipt["requests"][0]["response"]["result"]["content"][0]["text"] == "1.8.6\n"
assert receipt["requests"][2]["response"]["result"]["content"][0]["text"] == "1.8.6\n"
assert receipt["anthraciteBefore"]["mcpStatus"] == 1
assert receipt["anthraciteBefore"]["stderr"] == "Unknown argument: mcp\n"
assert receipt["learn"]["contents"][0]["bytes"] == 35304

evidence = json.loads((root / "rea-stdio-probe-final.json").read_text())
observation = evidence["normalized_result"]
assert observation["exit"]["code"] == 0 and observation["truncated"] is False
raw = observation["truncation_details"]["raw_terminal"]
assert raw["observed_bytes"] == raw["retained_bytes"]
recorded = next(item for item in observation["files_after"] if item["path"] == "root_0:receipt.json")
assert recorded["sha256"] == hashlib.sha256((root / "protocol-receipt.json").read_bytes()).hexdigest()

print("All retained hashes, protocol observations and receipt binding verified.")
