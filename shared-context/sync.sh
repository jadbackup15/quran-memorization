#!/bin/sh
# Mirror the live shared-context files into the repo so they are backed up and
# versioned. The live copies under ~/.claude are the source of truth; this only
# ever copies IN that direction, so an edit here is overwritten, not merged.
set -e
cd "$(dirname "$0")"
for f in platform.md project-template.md; do
  if cmp -s "$HOME/.claude/$f" "$f"; then
    echo "unchanged: $f"
  else
    cp "$HOME/.claude/$f" "$f"
    echo "updated:   $f"
  fi
done
echo "Now: git add shared-context && git commit"
