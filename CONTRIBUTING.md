# Contributing

AgentMount changes follow the repository workflow policy in
`.ai/workflow-gates.json`.

## Before opening a pull request

1. Work on a feature branch; do not push directly to `main`.
2. Run `bun run prepack` from a clean checkout.
3. Run the required pre-push review gate and resolve blocking findings.
4. Run the relevant smoke or soak check. A documentation-only change may record
   the policy-authorized skip only when no runnable surface changed.
5. Open a PR and wait for the independent Claude review to complete.

## Delivery truth

`bun ./.ai/protocols/workflow-gates/validate-workflow-gates.ts repo --root .`
checks the repository's intended mainline, reviewer policy, changed files, and
worktree attribution. Use it before reporting status, selecting the next work,
or merging.

The `closeout` validator is deliberately stricter than repository mode. It is
used only when a named workstream has all retained test, smoke, soak, release,
acceptance, planning, and artifact evidence required to claim `closed`.

## Policy changes

Changes to `.ai/workflow-gates.json` or `.ai/code-reviewers.json` alter the
delivery controls for every contributor. They require named-human approval and
independent review before merge.
