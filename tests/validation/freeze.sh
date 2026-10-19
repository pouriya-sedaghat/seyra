#!/usr/bin/env bash
# Prepare an immutable copy of one commit for running repository harnesses (lifecycle, offline,
# restore, security) without depending on the working tree, which may be edited during a long run.
#
#   tests/validation/freeze.sh COMMIT RUN_DIR
#   # then, for example (root runner, see runner.Dockerfile):
#   #   SEYRA_REPO=RUN_DIR/src RUN_DIR/src/tests/lifecycle/lifecycle.sh
#
# RUN_DIR/src is `git archive COMMIT`; tests/, bin/ and fixtures/ are made read-only for the
# operator. RUN_DIR/revision.txt records the commit, tree, archive digest and the digest of every
# script under tests/. Harnesses write evidence below RUN_DIR/src/docs/evidence; copy it out
# afterwards. Refuses to reuse an existing RUN_DIR/src.
set -euo pipefail
commit="${1:?usage: freeze.sh COMMIT RUN_DIR}"
run="${2:?usage: freeze.sh COMMIT RUN_DIR}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
full="$(git -C "$repo" rev-parse --verify "$commit^{commit}")"
[ ! -e "$run/src" ] || { echo "refusing: $run/src already exists" >&2; exit 2; }
mkdir -p "$run/src"
archive="$(mktemp "$run/.source.XXXXXX.tar")"
git -C "$repo" archive --format=tar "$full" > "$archive"
tar -xf "$archive" -C "$run/src"
{
  echo "commit: $full"
  echo "tree: $(git -C "$repo" rev-parse "$full^{tree}")"
  echo "archive_sha256: $(sha256sum "$archive" | cut -d' ' -f1)"
  echo "frozen_at: $(date -u +%FT%TZ)"
  echo "frozen_copy: $run/src"
  (cd "$run/src" && find tests bin -type f -print0 | sort -z | xargs -0 sha256sum)
} > "$run/revision.txt"
rm -f "$archive"
chmod -R a-w "$run/src/tests" "$run/src/bin" "$run/src/fixtures"
echo "$run/src"
