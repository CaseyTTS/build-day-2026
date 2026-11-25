#!/usr/bin/env bash
# Build Day 2026: run every drop's tests and demos in mock (stand-in) mode, then print a pass/fail summary.
# Works on macOS, Linux, WSL and Git Bash. No keys, no network calls to any model.
#
# Usage:  bash run-all.sh [path-to-build-day-2026]      (default: current folder)
#         QUICK=1 bash run-all.sh                        (skip npm ci / pip install if already done)
set -u

REPO="${1:-$PWD}"
REPO="$(cd "$REPO" 2>/dev/null && pwd)" || { echo "Repo folder not found: ${1:-$PWD}"; exit 2; }
[ -d "$REPO/01-triage" ] && [ -d "$REPO/06-finale" ] || { echo "Not the build-day-2026 folder: $REPO"; exit 2; }

# Force mock / stand-in mode for every drop, whatever is in the shell.
export TRIAGE_PROVIDER=mock RAG_PROVIDER=mock HARNESS_PLANNER=mock HARNESS_APPROVE=deny MODEL_PROVIDER=standin
unset SCORER RAG_MIN_SCORE TRIAGE_REVIEW_BELOW HARNESS_SANDBOX HARNESS_LOG 2>/dev/null || true

# Pick a Python 3.10+ interpreter (python3 on Mac/Linux, python or py on Git Bash).
PY=""
for c in python3 python "py -3"; do
  if $c -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "Python 3.10+ not found (3.13 recommended)."; exit 2; }
command -v node >/dev/null || { echo "Node.js not found (24 recommended, 22+ required)."; exit 2; }
command -v npm  >/dev/null || { echo "npm not found."; exit 2; }

LOGDIR="${LOGDIR:-${TMPDIR:-/tmp}/build-day-run-all}"; mkdir -p "$LOGDIR"
echo "Build Day run-all | repo: $REPO"
echo "python: $($PY --version 2>&1) | node: $(node --version) | npm: $(npm --version)"
echo "logs: $LOGDIR"
echo

RESULTS=()
FAILS=0
WARNS=()
warn_skips() { # name skipped-count -> WARN line when a suite skipped tests
  if [ "${2:-0}" -gt 0 ] 2>/dev/null; then
    WARNS+=("WARN $1: $2 test(s) skipped; a skipped test proved nothing (see its log for the reason)")
    echo "  WARN $1: $2 test(s) skipped"
  fi
}
record() { # name status detail
  RESULTS+=("$(printf '%-34s %-5s %s' "$1" "$2" "$3")")
  [ "$2" = "PASS" ] || FAILS=$((FAILS+1))
  printf '  %-34s %-5s %s\n' "$1" "$2" "$3"
}
step() { # name logfile expected-regex command...  -> PASS only if exit 0 AND the output shows the expected line
  local name="$1" log="$2" want="$3"; shift 3
  if ! "$@" >"$log" 2>&1; then record "$name" FAIL "(exit code, see $log)"
  elif ! grep -Eq "$want" "$log"; then record "$name" FAIL "(no '$want' in output, see $log)"
  else record "$name" PASS "$(grep -E "$want" "$log" | tail -1 | cut -c1-70)"; fi
}

venv_py() { # path to the venv's python (bin/ on Mac/Linux/WSL, Scripts/ on Git Bash)
  if [ -x "$1/.venv/bin/python" ]; then echo "$1/.venv/bin/python"; else echo "$1/.venv/Scripts/python.exe"; fi
}

run_python_drop() { # folder demo-function
  local d="$1"; local dir="$REPO/$d"; cd "$dir" || return
  echo "== $d"
  if [ ! -d .venv ]; then $PY -m venv .venv >"$LOGDIR/$d-venv.log" 2>&1 || { record "$d setup" FAIL "(venv)"; return; }; fi
  local VPY; VPY="$(venv_py "$dir")"
  if [ -z "${QUICK:-}" ] || ! "$VPY" -c 'import pytest' >/dev/null 2>&1; then
    "$VPY" -m pip install -q -r requirements-dev.txt >"$LOGDIR/$d-pip.log" 2>&1 || { record "$d setup" FAIL "(pip, see $LOGDIR/$d-pip.log)"; return; }
  fi
  local log="$LOGDIR/$d-test.log"
  if "$VPY" -m pytest -q -p no:cacheprovider >"$log" 2>&1; then
    local sk; sk="$(grep -Eo '[0-9]+ skipped' "$log" | tail -1 | grep -Eo '[0-9]+')"; sk="${sk:-0}"
    record "$d tests" PASS "$(grep -Eo '[0-9]+ passed' "$log" | tail -1), $sk skipped"
    warn_skips "$d tests" "$sk"
  else
    record "$d tests" FAIL "$(grep -Eo '[0-9]+ (passed|failed)' "$log" | tr '\n' ' ')(see $log)"
  fi
  "$2" "$VPY" "$d"
}

demo_01() { step "$2 demo (run samples)" "$LOGDIR/$2-demo.log" "13 items, 5 auto-routed, 8 sent to a person" "$1" triage.py run samples.jsonl; }
demo_02() {
  local log="$LOGDIR/$2-demo.log"
  if "$1" rag.py index docs/ >"$log" 2>&1 \
     && "$1" rag.py ask "My VPN won't connect, what should I check first?" >>"$log" 2>&1 \
     && "$1" rag.py ask "When are accruals posted?" --groups everyone >>"$log" 2>&1 \
     && "$1" rag.py eval questions.jsonl >>"$log" 2>&1 \
     && grep -q "retrieval: 5/5 correct" "$log"; then
    record "$2 demo (index/ask/eval)" PASS "$(grep -Eo '[0-9]+/[0-9]+' "$log" | tail -1)"
  else record "$2 demo (index/ask/eval)" FAIL "(see $log)"; fi
}
demo_03() { step "$2 demo (gate, deny mode)" "$LOGDIR/$2-demo.log" "write_file +not-approved" "$1" harness.py; }

run_node_drop() { # folder then pairs of: "demo command" "regex the output must contain"
  local d="$1"; shift; local dir="$REPO/$d"; cd "$dir" || return
  echo "== $d"
  if [ -z "${QUICK:-}" ] || [ ! -d node_modules ]; then
    npm ci --no-audit --no-fund >"$LOGDIR/$d-npm-ci.log" 2>&1 || { record "$d setup" FAIL "(npm ci, see $LOGDIR/$d-npm-ci.log)"; return; }
  fi
  local log="$LOGDIR/$d-test.log"
  if npm test >"$log" 2>&1; then
    local sk; sk="$(grep -Eo '(ℹ|#) skipped [0-9]+' "$log" | tail -1 | grep -Eo '[0-9]+')"; sk="${sk:-0}"
    record "$d tests" PASS "$(grep -Eo '(ℹ|#) pass [0-9]+' "$log" | tail -1 | grep -Eo '[0-9]+') passed, $sk skipped"
    warn_skips "$d tests" "$sk"
  else
    record "$d tests" FAIL "$(grep -Eo '(ℹ|#) (pass|fail) [0-9]+' "$log" | tr '\n' ' ')(see $log)"
  fi
  local n=0
  while [ $# -ge 2 ]; do
    n=$((n+1))
    step "$d demo $n: $1" "$LOGDIR/$d-demo-$n.log" "$2" bash -c "$1"
    shift 2
  done
}

run_python_drop 01-triage demo_01
run_python_drop 02-rag demo_02
run_python_drop 03-harness demo_03
# Drop 4 demos write to out/ (git-ignored) so the committed samples/ folder is not overwritten.
run_node_drop 04-interview \
  "npm run demo:bot -- out"  "Wrote out/bot-transcript.json" \
  "npm run demo:team -- out" "Wrote out/team-transcript.json"
run_node_drop 05-homelab \
  "npm run lint" "eslint" \
  "npm run demo" "place: "
# Drop 6: each demo must actually print its run summary, not just exit 0.
run_node_drop 06-finale \
  "npm run check:playbooks" 'OK: playbook "marketing" passed' \
  "npm run demo" "Wrote outputs/marketing/denied/summary.md" \
  "npm run start -- --playbook marketing --approve" "Wrote outputs/marketing/approved/summary.md"

cd "$REPO"
echo
echo "================ SUMMARY ================"
for r in "${RESULTS[@]}"; do echo "$r"; done
echo "========================================="
if [ "${#WARNS[@]}" -gt 0 ]; then for w in "${WARNS[@]}"; do echo "$w"; done; fi
if [ "$FAILS" -eq 0 ] && [ "${#WARNS[@]}" -gt 0 ]; then echo "GREEN WITH WARNINGS (${#RESULTS[@]} checks, ${#WARNS[@]} WARN)"; exit 0; fi
if [ "$FAILS" -eq 0 ]; then echo "ALL GREEN (${#RESULTS[@]} checks)"; exit 0; else echo "$FAILS of ${#RESULTS[@]} checks FAILED. Open the log named next to each FAIL."; exit 1; fi
