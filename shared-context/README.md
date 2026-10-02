# Shared context

`~/.claude/platform.md` is the live file — every project's `CLAUDE.md` imports
it with `@~/.claude/platform.md`, and it is NOT inside any repo, so nothing
backs it up.

These are tracked copies, so the rules survive a lost machine and have a
history. They are a **mirror, not the source**: edit `~/.claude/platform.md`,
then run `./shared-context/sync.sh` to update these and commit.

- `platform.md` — rules that are true of any project, not just this one.
  Versioning, Telegram ingest, cloud sync, prompt/agent design, jsdom testing,
  print pagination, CSS/DOM traps, how to work.
- `project-template.md` — the starting `CLAUDE.md` for a NEW project: the
  import line, plus a checklist of what the shared file already covers so the
  same rules are not written out a second time.

A rule naming a Hizb, an ayah, a mushaf page or a screen in this app belongs in
this repo's own `CLAUDE.md`, never in `platform.md` — other projects load that
file and should never see this one's detail.
