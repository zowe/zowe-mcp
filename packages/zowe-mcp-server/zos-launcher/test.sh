#!/bin/sh
# Contract tests for zowex-launcher, run ON z/OS as the server userid
# (the userid holding the SURROGAT permits). POSIX sh — no bash on the LPAR.
#
#   ./test.sh <target-userid> [denied-userid] [uid0-userid]
#
# <target-userid>  a disposable account the invoker MAY switch to
#                  (READ on BPX.SRV.<target-userid> in SURROGAT)
# [denied-userid]  an existing account the invoker may NOT switch to
# [uid0-userid]    a UID 0 account, to prove the launcher refuses it
#
# Expected RACF setup for the positive case (SPECIAL admin):
#   RDEFINE SURROGAT BPX.SRV.<target> UACC(NONE)
#   PERMIT BPX.SRV.<target> CLASS(SURROGAT) ID(<invoker>) ACCESS(READ)
#   SETROPTS CLASSACT(SURROGAT)            (if not active)
#   SETROPTS RACLIST(SURROGAT) REFRESH     (if SURROGAT is RACLISTed)

cd "$(dirname "$0")"

TARGET="$1"
DENIED="$2"
UID0="$3"
if [ -z "$TARGET" ]; then
  echo "usage: $0 <target-userid> [denied-userid] [uid0-userid]" >&2
  exit 2
fi

fails=0
report() { # report <name> <ok:0|1> <detail>
  if [ "$2" -eq 0 ]; then
    echo "PASS: $1"
  else
    echo "FAIL: $1 -- $3"
    fails=$((fails + 1))
  fi
}

if [ ! -x ./zowex-launcher ]; then
  echo "error: ./zowex-launcher not built (run ./build.sh)" >&2
  exit 2
fi

echo "== invoker: $(id) =="
echo "== launcher extattr: $(extattr ./zowex-launcher 2>/dev/null | tr '\n' ' ') =="

# 1. Positive: switch to $TARGET; the child must report the target's uid.
#    Print full id output — record what happens to GROUPS (the setuid doc
#    leaves supplementary groups ambiguous on the surrogate path).
out=$(printf '%s\n' "$TARGET" | ./zowex-launcher /bin/sh -c 'id' 2>&1)
rc=$?
echo "-- id as target: $out"
case "$out" in
  *"($TARGET)"*) report "switch to $TARGET" 0 "" ;;
  *) report "switch to $TARGET" 1 "rc=$rc out=$out" ;;
esac

# 2. Stdin passthrough: bytes after the userid line must reach the child.
out=$(printf '%s\nhello-stdin\n' "$TARGET" | ./zowex-launcher /bin/cat 2>&1)
rc=$?
case "$out" in
  *hello-stdin*) report "stdin passthrough to exec'd program" 0 "" ;;
  *) report "stdin passthrough to exec'd program" 1 "rc=$rc out=$out" ;;
esac

# 3. HOME/USER/LOGNAME point at the target after the switch. Match line-wise:
#    a launcher warning (e.g. chdir failing because a disposable account's
#    home was never created) may legitimately precede the output.
out=$(printf '%s\n' "$TARGET" | ./zowex-launcher /bin/sh -c 'echo "$USER:$LOGNAME:$HOME"' 2>&1)
if printf '%s\n' "$out" | grep -q "^$TARGET:$TARGET:/"; then
  report "environment rebuilt for target" 0 ""
else
  report "environment rebuilt for target" 1 "out=$out"
fi

# 4. Unknown user -> exit 4, nothing executed.
printf 'NOSUCHU9\n' | ./zowex-launcher /bin/sh -c 'echo REACHED' >/tmp/zl-t4.out 2>&1
rc=$?
if [ "$rc" -eq 4 ] && ! grep -q REACHED /tmp/zl-t4.out; then
  report "unknown user rejected (exit 4)" 0 ""
else
  report "unknown user rejected (exit 4)" 1 "rc=$rc $(cat /tmp/zl-t4.out)"
fi
rm -f /tmp/zl-t4.out

# 5. Bad userid syntax -> exit 3.
printf 'BAD*ID\n' | ./zowex-launcher /bin/true 2>/dev/null
rc=$?
report "invalid userid syntax rejected (exit 3)" $([ "$rc" -eq 3 ] && echo 0 || echo 1) "rc=$rc"

# 6. Denied user (no SURROGAT permit) -> exit 5 with EPERM hint.
if [ -n "$DENIED" ]; then
  out=$(printf '%s\n' "$DENIED" | ./zowex-launcher /bin/sh -c 'echo REACHED' 2>&1)
  rc=$?
  case "$rc:$out" in
    5:*BPX.SRV.*) report "no-permit user denied (exit 5, EPERM hint)" 0 "" ;;
    *) report "no-permit user denied (exit 5, EPERM hint)" 1 "rc=$rc out=$out" ;;
  esac
else
  echo "SKIP: no-permit denial (pass a denied-userid to run it)"
fi

# 7. UID 0 target refused -> exit 6.
if [ -n "$UID0" ]; then
  printf '%s\n' "$UID0" | ./zowex-launcher /bin/true 2>/dev/null
  rc=$?
  report "UID 0 target refused (exit 6)" $([ "$rc" -eq 6 ] && echo 0 || echo 1) "rc=$rc"
else
  echo "SKIP: UID 0 refusal (pass a uid0-userid to run it)"
fi

# 8. Dirty address space: a copy loses extattr +p; with BPX.DAEMON defined the
#    switch must fail (EMVSERR/JRENVDIRTY), proving program control is enforced.
cp ./zowex-launcher /tmp/zl-unmarked && chmod 700 /tmp/zl-unmarked
out=$(printf '%s\n' "$TARGET" | /tmp/zl-unmarked /bin/sh -c 'echo REACHED' 2>&1)
rc=$?
case "$rc:$out" in
  5:*) report "unmarked copy cannot switch (program control enforced)" 0 "" ;;
  *REACHED*) report "unmarked copy cannot switch (program control enforced)" 1 "rc=$rc out=$out (is BPX.DAEMON defined?)" ;;
  *) report "unmarked copy cannot switch (program control enforced)" 1 "rc=$rc out=$out" ;;
esac
rm -f /tmp/zl-unmarked

# 9. Group-leak regression (live-LPAR finding, 2026-10-08): the switched
#    child's PROCESS group list must contain no group the target userid is
#    not connected to in the security database. setuid-then-exec leaked the
#    invoker's supplementary groups (with real USS authority); the identity
#    spawn must rebuild the list from the target's connections.
db=$(id "$TARGET" 2>/dev/null)
proc=$(printf '%s\n' "$TARGET" | ./zowex-launcher /bin/sh -c 'id' 2>/dev/null | tail -1)
leaked=""
for g in $(printf '%s\n' "$proc" | sed -n 's/.*groups=//p' | tr ',' '\n' \
           | sed -n 's/.*(\(.*\))$/\1/p'); do
  case "$db" in
    *"($g)"*) ;;
    *) leaked="$leaked $g" ;;
  esac
done
if [ -z "$leaked" ]; then
  report "no invoker group leaks into the switched child" 0 ""
else
  report "no invoker group leaks into the switched child" 1 \
    "process id: $proc -- leaked group(s):$leaked (not connected to $TARGET)"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "ALL TESTS PASSED"
else
  echo "$fails TEST(S) FAILED"
  exit 1
fi
