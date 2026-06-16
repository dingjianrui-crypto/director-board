# Repository Guidelines

## Project Structure & Module Organization

This repository is currently a blank workspace. When adding code, keep the layout predictable and shallow:

- `src/` for application source code and shared modules.
- `tests/` for automated tests that exercise behavior outside a single module.
- `assets/` for static files such as images, fixtures, and sample inputs.
- `docs/` for design notes, architecture decisions, and contributor-facing documentation.

Prefer feature-oriented folders under `src/` when the project grows, for example `src/board/`, `src/rendering/`, or `src/api/`. Keep generated files out of source directories unless they are required inputs.

## Build, Test, and Development Commands

No build system is present yet. Add commands to the project manifest or a `Makefile` as soon as tooling is introduced. Recommended command names:

- `npm run dev` or `make dev`: start the local development server.
- `npm run build` or `make build`: produce production-ready output.
- `npm test` or `make test`: run the full automated test suite.
- `npm run lint` or `make lint`: run static checks and formatting validation.

Document any required environment variables in `.env.example`, not only in private setup notes.

## Coding Style & Naming Conventions

Use consistent formatting enforced by the selected language toolchain. For JavaScript or TypeScript, prefer Prettier defaults, 2-space indentation, `camelCase` for variables/functions, `PascalCase` for components/classes, and kebab-case file names for route or utility files when appropriate.

Keep modules focused. Name files after the primary concept they export, for example `scene-store.ts`, `timeline-controls.tsx`, or `camera-path.test.ts`.

## Testing Guidelines

Place unit tests close to the related module or under `tests/`, depending on the framework chosen. Use clear names that describe behavior, such as `camera-path.test.ts` or `renders-empty-board.spec.ts`.

Add tests for parsing, state transitions, rendering logic, and bug fixes. When a test cannot be automated yet, include manual verification steps in the pull request.

## Commit & Pull Request Guidelines

There is no local Git history in this workspace, so use a simple conventional style for new commits: `feat: add board timeline`, `fix: handle empty scene`, or `docs: add contributor guide`.

Pull requests should include a concise summary, testing performed, linked issues when relevant, and screenshots or short recordings for UI changes. Keep PRs scoped to one feature or fix whenever possible.

## Security & Configuration Tips

Do not commit secrets, private tokens, local credentials, or machine-specific paths. Provide safe defaults in `.env.example` and keep real values in ignored local files.
