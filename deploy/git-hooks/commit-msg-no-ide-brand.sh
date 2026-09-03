#!/bin/sh
# Global (account #1): strip Cursor/AI attribution; then run repo-local commit-msg if any.
msg_file="$1"
[ -f "$msg_file" ] || exit 0
tmp="$(mktemp)"
sed -E \
  -e '/^[[:space:]]*Co-authored-by:[[:space:]]*Cursor/Id' \
  -e '/^[[:space:]]*Co-authored-by:[[:space:]]*.*[Cc]ursor[Aa]gent/Id' \
  -e '/^[[:space:]]*Made-with:[[:space:]]*Cursor/Id' \
  -e '/^[[:space:]]*Made with[[:space:]]+[Cc]ursor/Id' \
  "$msg_file" > "$tmp"
awk 'BEGIN{n=0} {a[++n]=$0} END{while(n>0 && a[n]~/^[[:space:]]*$/) n--; for(i=1;i<=n;i++) print a[i]}' "$tmp" > "$msg_file"
rm -f "$tmp"

# Chain to the repository's own commit-msg (core.hooksPath replaces .git/hooks).
if command -v git >/dev/null 2>&1; then
  local_hook="$(git rev-parse --git-path hooks/commit-msg 2>/dev/null || true)"
  if [ -n "$local_hook" ] && [ -x "$local_hook" ] && [ "$local_hook" != "$0" ]; then
    # avoid recursion if someone copied global hook into .git/hooks
    if ! grep -q 'strip Cursor/AI attribution' "$local_hook" 2>/dev/null; then
      "$local_hook" "$msg_file" || exit $?
    fi
  fi
fi
exit 0
