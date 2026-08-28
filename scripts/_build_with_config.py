#!/usr/bin/env python3
import json, os, subprocess, sys
env = json.load(open(sys.argv[1]))
proc_env = dict(os.environ)
n = 0
for e in env:
    if e["name"].startswith("VITE_"):
        proc_env[e["name"]] = e["value"]
        n += 1
print(f"injected {n} VITE_* vars", flush=True)
sys.exit(subprocess.run(["npm", "run", "build"], cwd=sys.argv[2], env=proc_env).returncode)
