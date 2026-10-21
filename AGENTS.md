# Repository Guidelines

## Project Structure & Module Organization

This repository is a browser-focused Rich4 remake using TypeScript and Vite. Application code lives in `game/src/`: `core/` contains the deterministic rules engine, `ui/` handles browser interactions, `renderer/` provides Canvas and experimental WebGL backends, and `assets/` manages loading and offline support. Unit tests sit beside source files; browser tests live in `game/tests/e2e/`. Build and release utilities are in `game/scripts/`, deployment configuration in `deploy/`, rule specifications in `docs/rules/`, and architecture and acceptance records in `docs/plan/`. Keep new work aligned with the Web focus despite retained native packaging directories.

## Build, Test, and Development Commands

Use Node.js 22, matching CI. Run commands from `game/`:

- `npm ci`: install locked dependencies.
- `npm run dev`: start Vite at `http://127.0.0.1:5173/`.
- `npx tsc --noEmit`: check strict TypeScript types.
- `npm test`: run Vitest unit and regression tests.
- `RICH4_NO_ASSETS=1 npm run build:web`: build for `/rich4/` without copying private assets.
- `npm run verify:web:code`: verify the code-only bundle and PWA shell.
- `npx playwright install chromium` followed by `npm run test:e2e:code`: run browser smoke tests.
- `npm run test:e2e:full` and `npm run verify:web`: validate gameplay and deployment with complete private assets available.

## Coding Style & Naming Conventions

Follow existing TypeScript style: two-space indentation, single quotes, semicolons, and ES module imports. Use kebab-case filenames, camelCase functions and variables, and PascalCase classes and types. Preserve deterministic engine behavior and seeded randomness; consult `docs/rules/` before changing mechanics. No dedicated formatter or linter is configured; strict TypeScript checks reject unused locals and parameters.

## Testing Guidelines

Name Vitest tests `*.test.ts` and Playwright tests `*.spec.ts`. Add targeted regression tests for behavior changes, especially rules, saves, networking, resources, and rendering. No numeric coverage threshold is configured. Asset-dependent tests may skip when fixtures are unavailable; report skips and unexecuted device checks explicitly. Code-only success does not establish full gameplay or production readiness.

## Commit & Pull Request Guidelines

Follow the observed Conventional Commit style: `feat(perf): ...`, `fix(deploy): ...`, or `test(e2e): ...`. Link relevant issues. PRs should describe scope, behavior changes, affected save formats or protocols, verification results, and known risks or rollback steps. Include screenshots for visual changes and performance comparisons when relevant; follow `docs/plan/07-acceptance-and-quality.md`.

## Assets & Configuration

Keep proprietary game assets under ignored `game/public/assets/`; never commit asset archives, credentials, or generated release output. Assets are outside the source code's GPL license and restricted to private use.
