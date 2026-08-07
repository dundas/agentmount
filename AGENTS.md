# AGENTS.md

Guidance for Codex and compatible agents working in AgentMount.

## Source of Truth

- Primary project instructions are in `CLAUDE.md`.
- Brain identity and communication policy are in `brain/config.json` and `brain/AGENTS.md`.
- Persistent project knowledge is in `memory/MEMORY.md` and `memory/daily/`.

## Session Start

1. Read `CLAUDE.md`, `brain/AGENTS.md`, `memory/MEMORY.md`, and recent daily logs.
2. Check messaging with `bun .agents/skills/cross-brain-message/brain-msg.ts inbox`.
3. Process work orders before lower-priority work.

## Default Workflow

- Use Bun for install, build, type checking, and tests.
- Keep the transport-neutral contract dependency-light and preserve deterministic compilation.
- Treat mutable authority, credentials, grants, consent, epochs, and run generations as runtime state; never place them in portable mount artifacts.
- Make configuration explicit. Do not hard-code deployment-specific values.
- Run the smallest relevant validation first, then `bun run prepack` for release-facing changes.

## Security

- Never commit API keys, credentials, passwords, tokens, database URIs, or private key material.
- Use machine-level credential storage or ignored local environment files for secrets.
- Do not weaken mount isolation, resource bounds, revocation fencing, publisher integrity, or exact authorization checks for convenience.
