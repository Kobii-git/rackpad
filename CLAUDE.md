# Claude Code adapter

Follow `AGENTS.md` as the canonical shared instruction set. Route task context
through `.ai/INDEX.md` and load only the documents named for the current task.

Use plan mode for substantial or ambiguous work, but continue into implementation
when the request asks for a change. Use subagents only for independent bounded
work that can be safely reconciled. Treat permission prompts as action-specific;
never infer permission to release, deploy, touch real data, or weaken controls.

Do not duplicate or override shared project rules in this file.
