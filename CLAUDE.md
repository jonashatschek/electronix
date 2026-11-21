# Electronix

A browser game for learning electronics, built on a real circuit simulator. See README.md for the roadmap; work is tracked in GitHub issues (https://github.com/jonashatschek/electronix/issues).

## Commands

- `npm run dev`: dev server at http://localhost:5173
- `npm test`: Vitest suite (simulator and examples)
- `npm run build`: type-check and production build

## Workflow

- **QA is mandatory.** After any change to `src/**` (feature, fix or refactor), run the `qa` subagent (`.claude/agents/qa.md`) with the scope of the change before reporting the work as done or committing. It reviews for bugs and writes tests. Fix what it finds (or explain why not), and relay its findings and test results to the user.
- Every bug fix gets a regression test.
- Commit messages reference issues (`Closes #N`).

## Conventions

- `src/sim/` is pure TypeScript with no React, and every part lives in its own file in `src/sim/components/`. A new part = one `ComponentDef` + registration in `components/index.ts` + a symbol in `src/editor/PartView.tsx`.
- Expected values in tests are hand-calculated from physics, never copied from simulator output.
- In-game text teaches: keep it physically accurate and beginner-friendly.
