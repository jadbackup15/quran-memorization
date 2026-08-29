#!/bin/zsh -l
# Double-click this file in Finder (or run it from a terminal) to commit
# and push any changes to the agent-prompts/ folder — the Markdown files
# behind the Agent Chat tab's "General"/"Print Suggestions" prompts.
#
# Scoped deliberately narrowly to just that folder, so it never
# accidentally commits unrelated in-progress work elsewhere in the repo.
# `-l` (login shell) so this picks up the same PATH/git as a real
# terminal, even when launched from Finder with a more minimal environment.
#
# This exists because of a real incident: an edit to a prompt file was
# made locally but never committed/pushed, so the live site kept serving
# the old wording with no obvious sign anything was wrong. This script
# makes "actually ship the edit" a single double-click.

set -e
cd "$(dirname "$0")"

echo "Quran Memorization — commit & push agent-prompts/"
echo "=================================================="
echo

echo "Checking agent-prompts/ for changes..."
git add agent-prompts/

if git diff --cached --quiet -- agent-prompts/; then
  echo "No changes to commit in agent-prompts/ — nothing to do."
  echo
  read "?Press Enter to close..."
  exit 0
fi

echo
echo "Changes to be committed:"
git diff --cached --stat -- agent-prompts/
echo

git commit -m "Update agent prompts" -- agent-prompts/

echo
echo "Pushing to origin main..."
git push origin main

echo
echo "Done — the live site will pick this up on its next load."
echo
read "?Press Enter to close..."
