#!/usr/bin/env python3
"""Independent pinned-Step chain checks; not execution of the PowerShell module.

Usage: python verify-lan-pki-80935b4.py CANDIDATE STEP_0_31_LINUX OUTPUT_JSON
Uses only disposable test keys and documentation IPs. No Windows/store/VM access.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
from datetime import datetime, timedelta, timezone

candidate, step, output = map(lambda x: Path(x).resolve(), sys.argv[1:4])
rows = []

with tempfile.TemporaryDirectory(prefix="seyra-step-review-") as scratch:
    w = Path(scratch)
    env = dict(os.environ, STEPPATH=str(w / "step-home"))

    def run(args):
        return subprocess.run(list(map(str, args)), cwd=w, env=env,
                              stdin=subprocess.DEVNULL, capture_output=True,
                              text=True, timeout=25)

    def setup(args):
        r = run(args)
        if r.returncode:
            raise RuntimeError(f"fixture setup failed: {r.stderr.replace(str(w), '<TEMP>')}")
        return r.stdout

    version = setup([step, "version"]).strip()
    if "Smallstep CLI/0.31.0" not in version:
        raise RuntimeError("wrong pinned Step version")
    openssl = setup(["openssl", "version"]).strip()
    template = candidate / "infra/tls/lan-pki/windows/server-leaf.tpl"

    # Unencrypted keys are disposable fixtures only, deleted with this directory.
    setup([step, "certificate", "create", "Review root", "root.crt", "root.key",
           "--profile", "root-ca", "--kty", "EC", "--curve", "P-256",
           "--not-after", "43800h", "--no-password", "--insecure"])
    setup([step, "certificate", "create", "Review issuing", "issuing.crt", "issuing.key",
           "--profile", "intermediate-ca", "--ca", "root.crt", "--ca-key", "root.key",
           "--kty", "EC", "--curve", "P-256", "--not-after", "8760h",
           "--no-password", "--insecure"])
    setup([step, "certificate", "create", "Unrelated review root", "other.crt", "other.key",
           "--profile", "root-ca", "--kty", "EC", "--curve", "P-256",
           "--not-after", "43800h", "--no-password", "--insecure"])
    setup(["openssl", "req", "-new", "-newkey", "ec", "-pkeyopt",
           "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", "server.key",
           "-out", "server.csr", "-subj", "/CN=198.18.0.76",
           "-addext", "subjectAltName=IP:198.18.0.76"])

    def sign(name, not_before, not_after):
        pem = setup([step, "certificate", "sign", "server.csr", "issuing.crt", "issuing.key",
                     "--template", template, "--set", "ip=198.18.0.76",
                     "--not-before", not_before, "--not-after", not_after])
        (w / name).write_text(pem)
        return pem

    good = sign("leaf.crt", "-5m", "2160h")
    now = datetime.now(timezone.utc)
    iso = lambda t: t.strftime("%Y-%m-%dT%H:%M:%SZ")
    future = sign("future.crt", iso(now + timedelta(hours=2)),
                  iso(now + timedelta(hours=2, days=90)))
    issuing = (w / "issuing.crt").read_text()
    (w / "chain.pem").write_text(good.rstrip() + "\n" + issuing.rstrip() + "\n")
    (w / "future-chain.pem").write_text(future.rstrip() + "\n" + issuing.rstrip() + "\n")
    der = base64.b64decode("".join(line for line in good.splitlines() if not line.startswith("-----")))
    broken = der[:-1] + bytes([der[-1] ^ 1])
    bad_pem = ("-----BEGIN CERTIFICATE-----\n" +
               textwrap.fill(base64.b64encode(broken).decode(), 64) +
               "\n-----END CERTIFICATE-----\n")
    (w / "bad-chain.pem").write_text(bad_pem + issuing)

    def check(label, cert, root, host, expected_success):
        r = run([step, "certificate", "verify", cert, "--roots", root, "--host", host])
        rows.append({"label": label, "exit_code": r.returncode,
                     "expected_success": expected_success,
                     "passed": (r.returncode == 0) == expected_success,
                     "stderr": r.stderr.replace(str(w), "<TEMP>").strip()})

    check("complete chain, explicit root, correct IP", "chain.pem", "root.crt", "198.18.0.76", True)
    check("missing intermediate refused", "leaf.crt", "root.crt", "198.18.0.76", False)
    check("unrelated root refused", "chain.pem", "other.crt", "198.18.0.76", False)
    check("wrong IP refused", "chain.pem", "root.crt", "198.18.0.99", False)
    check("future NotBefore refused", "future-chain.pem", "root.crt", "198.18.0.76", False)
    check("altered leaf signature refused", "bad-chain.pem", "root.crt", "198.18.0.76", False)
    check("missing root file refused", "chain.pem", "absent.crt", "198.18.0.76", False)
    checksums = {str(f.relative_to(candidate)): hashlib.sha256(f.read_bytes()).hexdigest()
                 for f in (candidate / "infra/tls/lan-pki/windows").glob("*") if f.is_file()}

report = {"scope": "Pinned Linux Step CLI and exact leaf+intermediate/explicit-root construction. "
                   "No PowerShell module, Windows, Docker image or VM service execution.",
          "step_version": version, "openssl": openssl, "source_sha256": checksums,
          "checks": len(rows), "failed": sum(not x["passed"] for x in rows), "results": rows}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"checks": report["checks"], "failed": report["failed"]}))
sys.exit(0 if report["failed"] == 0 else 1)
