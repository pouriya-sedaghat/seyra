#!/usr/bin/env bash
# PREPARATION ENVIRONMENT ONLY (may use the Internet). Fetch pinned sources and artifacts into
# $SEYRA_SOURCES, verifying every commit and checksum listed in sources.json.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dest="${SEYRA_SOURCES:?set SEYRA_SOURCES to an empty or existing sources directory}"
mkdir -p "$dest/artifacts"
python3 -I - "$here/sources.json" "$dest" <<'PY'
import json, subprocess, sys, os, hashlib, urllib.request
cfg = json.load(open(sys.argv[1])); dest = sys.argv[2]
for name, s in cfg["sources"].items():
    path = os.path.join(dest, name)
    if not os.path.isdir(path):
        subprocess.run(["git", "-c", "advice.detachedHead=false", "clone", "-q", "--depth", "1", "--branch", s["tag"], s["url"], path], check=True)
        if s.get("submodules"):
            subprocess.run(["git", "-C", path, "submodule", "update", "--init", "--recursive", "--depth", "1"], check=True)
    head = subprocess.run(["git", "-C", path, "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    if head != s["commit"]:
        sys.exit(f"{name}: checked out {head}, expected {s['commit']}")
    print(f"ok  {name} {s['tag']} {head}")
for fname, a in cfg["artifacts"].items():
    p = os.path.join(dest, "artifacts", fname)
    if not os.path.exists(p) and a["url"].startswith("https://github.com/"):
        subprocess.run(["curl", "-fsSL", "-o", p, a["url"]], check=True)
    if not os.path.exists(p):
        sys.exit(f"{fname}: download manually from {a['url']} into {p}")
    h = hashlib.sha256(open(p, "rb").read()).hexdigest()
    if h != a["sha256"]:
        sys.exit(f"{fname}: sha256 {h} != {a['sha256']}")
    print(f"ok  {fname} {h}")
PY
