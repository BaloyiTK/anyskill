# Mandatory instructions for AI agents and contributors

These instructions apply to every task in this repository.

## Required reading before work

Before investigating, planning, editing, reviewing, or proposing implementation changes:

1. Read [AnySkill Engineering Standards](ENGINEERING_STANDARDS.md) in full.
2. Read [AnySkill Project Rules](PROJECT_RULES.md) in full.
3. Read the relevant specifications and decisions under [docs/architecture](docs/architecture/).
4. Inspect the current implementation and its tests. Documentation does not replace code inspection.

Do not claim that a document, test, command, or configuration was checked unless it was actually inspected or executed in the current task. If a required document cannot be accessed, say so and do not pretend it was consulted.

## Authority and conflict resolution

Follow applicable law, platform requirements, and current official documentation first. Within the repository, apply the engineering standards, project rules, and relevant architecture decisions together. A more specific project rule supplements the general standard; it does not silently waive security, correctness, or quality requirements. If requirements conflict, stop, explain the conflict and risk, and obtain a decision before proceeding.

## Required change workflow

For every non-trivial change:

1. Inspect the current branch, working tree, relevant files, architecture documents, API contracts, and official version-specific documentation.
2. Identify the root cause and map affected modules, data, API, security, and platform boundaries.
3. Choose the smallest robust compatible implementation.
4. Add or update tests and documentation with the implementation.
5. Review for security, privacy, performance, accessibility, and regressions.
6. Run the relevant checks; report exact results and anything not run.
7. Inspect the final diff for unrelated changes, generated files, and secrets.
8. Summarize changed files, decisions, checks, and remaining risks.

## Protected project constraints

- Follow [PROJECT_RULES.md](PROJECT_RULES.md) for dependency pins, Expo/EAS identity, build profiles, environment handling, native project workflow, Git safety, and collaboration expectations.
- Never upgrade, replace, or add dependencies without the approval required by PROJECT_RULES.md.
- Never use dependency update commands or disable frozen-lockfile validation.
- Never remove or weaken a failing test, CI check, security control, or configuration guard merely to obtain a green build.
- Never overwrite local environment files, expose secret values, or commit credentials.
- Never reset, force-push, rewrite history, deploy, or change production resources without explicit authorization.
- Preserve existing user changes. Do not assume an uncommitted local change is disposable.

## Completion

Use the Definition of Done in ENGINEERING_STANDARDS.md. A task is not complete merely because code was written. State what was verified, what was not verified, and why. Do not claim production readiness without the evidence required by the engineering standards.
