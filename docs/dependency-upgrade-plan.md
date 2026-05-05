# Dependency Upgrade Plan

A staged plan to upgrade every dependency in this repo, run as much of the work
as possible from a coding assistant in a sandbox, and ship a release at the end
of every milestone.

This is a sketch, not a contract. It assumes the answers captured at the top of
the [Decisions](#decisions) section. Adjust and re-plan if those change.

## Decisions

These were chosen up front. They drive the structure below.

| # | Decision | Choice |
|---|---|---|
| 1 | Toolchain | **Migrate to Vite** (drop `@vue/cli-service` + webpack 4) |
| 2 | HTTP client to replace `request` | **`got`** |
| 3 | Final Node target | **Node 24 LTS** (with 20 LTS and 22 LTS as intermediate milestones) |
| 4 | Per-milestone platform strategy | **Linux first**, then chase macOS + Windows at the end of each milestone (the "chase day" gate) |
| 5 | E2E framework | **Playwright** under `xvfb-run` |
| 6 | Sentry | **Keep** and migrate `@sentry/electron` 4 → 7 (drop branch noted in M3) |
| 7 | What "done" means per milestone | **Cut a release** (signed/notarized macOS, signed Windows, Linux AppImage) before opening the next milestone |

## Scope and constraints

* All non-release work runs in a sandbox: `npm ci`, lint, vitest, Playwright
  under `xvfb-run`, `electron-builder --linux`. No outbound network beyond the
  npm registry. No real ClickUp credentials.
* macOS notarization and Windows code signing must run on real GitHub-hosted
  runners with secrets — the assistant can prepare PRs but cannot finish a
  release alone.
* The app is private to its calendar-and-IPC surface. Any UI regression that
  isn't covered by an automated test will be missed unless somebody opens the
  app.

## Current state (snapshot at planning time)

Toolchain pain points that block straightforward upgrades:

* **`@vue/cli-service` 5.0.8 + `vue-cli-plugin-electron-builder` 2.1.1** —
  webpack 4 under the hood. The plugin had its last release in Aug 2022 and is
  effectively dead. Webpack 4 doesn't run on Node ≥ 17 with default OpenSSL
  (`error:0308010C`), which is why `.nvmrc` pins 16.20.2 and CI uses `node-version: 16`.
* **`request` is imported directly** at `src/clickup-service.js:1` but is only a
  *transitive* dep of `electron-builder` 23. Any upgrade of electron-builder
  removes `request` from the tree and breaks the import. ~18 call sites in
  `clickup-service.js`.
* **Node 16 is EOL.** All three CI matrix runners use it.
* **Sentry SDK 4** vs current 7 — major API churn around init.
* **`electron-store` 8** — v9+ is ESM-only, conflicts with current CJS-style
  `require` use in mixed files.
* **`electron-notarize`** is renamed to `@electron/notarize`. `notarize.js`
  still references the old name (currently dead-code: `afterSign` is commented
  out in `vue.config.js:50`).
* **`babel-eslint`** is deprecated (replaced by `@babel/eslint-parser`); ESLint 7
  is two majors behind.
* **Tailwind 3 → 4** is a CSS-first rewrite (no JS config). Real migration cost.
* `electron-builder` is listed in *both* `dependencies` and `devDependencies` of
  `package.json` — clean up during M1.

## Testing infrastructure: current vs required

### Current

* One vitest file: `src/task-search.test.js` (pure-function unit tests for
  `searchTasks`).
* CI: `actions/checkout@v4` → setup-node 16 → `npm ci` → `npm test` → conditional
  electron build only on `v*` tag.
* No lint in CI, no typecheck, no coverage gates, no e2e, no boot smoke test, no
  audit, no Dependabot/Renovate.

### Gaps that have to be closed before any major bump

| Gap | What to add | Why this gate matters for upgrades |
|---|---|---|
| Network layer untested | Mock the ClickUp API with **MSW** (`msw/node`); lift HTTP into one `httpClient` object | `request` → `got` migration is invisible without it |
| `events-factory.js`, `cache.js`, `time-utils.js`, `app-updater.js` untested | Vitest unit tests | Changes to electron-store / electron-updater APIs would silently regress |
| No app-boot smoke | **Playwright + `_electron`** running in CI on **every PR** (Linux under `xvfb-run`) and on the **full three-OS matrix** pre-tag and nightly. Open the window, assert splash mounts, exercise one IPC round-trip with the mocked HTTP layer | Webpack→Vite, Electron major, and SDK bumps all break boot in non-obvious ways; macOS/Windows-only regressions need the matrix gate before a release publishes |
| No Linux build smoke per PR | Add `npm run build:linux -- --dir` (no publish) to CI on every PR, then point Playwright at the unpacked output | Catches `electron-builder` config regressions before tag day |
| No lint in CI | Run `npm run lint` | Catches breaking lint-config bumps locally rather than during release |
| No coverage gate | Vitest `--coverage` with a ratcheting threshold per milestone | Stops upgrade PRs from quietly stripping tests |
| No dependency hygiene | **Dependabot** (or Renovate) with grouping (`electron-*`, `vue-*`, `eslint-*`, `vite-*`); `npm audit --omit=dev` advisory job | Ratchets minor/patch upgrades through the same gates |
| No commit-time lock check | `npm ci` already enforces this; add `actions/setup-node` cache | (Already partly there.) |

### Sandbox runnability of each gap

All of the above run inside a sandbox: vitest + MSW are pure JS, Playwright's
`_electron` driver works under `xvfb-run` with the AppImage or unpacked dir,
and `electron-builder --linux` only needs FUSE / `appimage-builder` deps that
the GitHub `ubuntu-latest` image already provides.

## Milestone overview

Each milestone is a coherent shippable release. Linux build & tests must pass on
every PR within the milestone; the macOS + Windows chase happens once at the
**chase day** that closes the milestone. The chase day is the only step that
requires non-Linux runners.

```
M0  Foundation (testing + CI gates)        no behavior change, Node 16
M1  Surgical replacements                  request→got, notarize→@electron/notarize, lint stack
M2  Vite migration                         drop vue-cli, drop webpack 4
M3  Node 20 + Electron major + Sentry 7    big bump, gated by M0 tests
M4  Vue/Tailwind ecosystem                 vue 3.5, tailwind 4, naive-ui, chart.js, etc.
M5  Node 22                                bump CI runners
M6  Node 24 (final)                        final pin
M+  Stabilization                          Dependabot keeps it green
```

Estimated effort assumes one engineer + an assistant in a sandbox. The
assistant can carry M0/M1/M2/M4 essentially end-to-end; M3/M5/M6 need a human
on chase day for signed releases.

---

## M0 — Foundation: tests and gates

**Goal**: no upgrade lands without passing Linux build, vitest, Playwright e2e,
and lint. Production behavior unchanged.

### Sandbox-runnable steps

1. Add `vitest --coverage` (`@vitest/coverage-v8`); commit a baseline coverage
   report and configure thresholds at the current floor.
2. Extract HTTP from `clickup-service.js` into `src/http-client.js` — a thin
   wrapper that the rest of the file calls. *Do not* swap `request` out yet;
   keep behavior identical. This lets tests mock the boundary now and lets M1
   replace the implementation cleanly.
3. Add **MSW** (`msw`, `msw/node`) and write tests for the most important
   `clickup-service.js` paths: `tokenValid`, `getCurrentUserId`,
   `getHierarchy` (cached + filtered), `_getFullHierarchy` (pagination), and
   error/retry handling.
4. Add unit tests for `events-factory.js` (closed/archived rules,
   `lock_closed_items`, `updateFromRemote`), `cache.js` (TTL, `clear`,
   `flush`), `time-utils.js`, and any pure helpers in `helpers.js`.
5. Add **Playwright** (`@playwright/test` + `playwright._electron`):
   * `tests/e2e/boot.spec.js` — launches the unpacked app, waits for splash,
     asserts that `#app` mounts, then quits cleanly.
   * `tests/e2e/ipc.spec.js` — stubs the ClickUp HTTP layer (via an env-var
     toggled MSW server in main process for e2e mode), sends a
     `get-clickup-hierarchy` IPC and asserts a `set-clickup-hierarchy` reply.
   * `playwright.config.js` — record `trace: 'retain-on-failure'`,
     `video: 'retain-on-failure'`, screenshot on failure. Output to
     `playwright-report/` and `test-results/`.
   * Local invocation: `xvfb-run -a npx playwright test` on Linux,
     `npx playwright test` directly on macOS/Windows.
6. Add `tests/e2e/build-smoke.spec.js` (or a separate CI step):
   `npm run build:linux -- --dir` then assert the AppImage executable exists
   and reports the expected version.
7. **Update `.github/workflows/build.yml` so E2E runs in CI**:
   * **Per-PR (cheap, Linux only)**: a `lint-and-test` job on `ubuntu-latest`,
     Node 16, that runs:
     ```
     npm ci
     npm run lint
     npm test -- --coverage
     npm run build:linux -- --dir         # produces dist_electron/linux-unpacked
     xvfb-run -a npx playwright test       # drives the unpacked binary
     ```
     Upload `playwright-report/`, `test-results/`, and coverage as workflow
     artifacts on failure (and always for the report) so a failed run is
     debuggable without re-running. Mark the job a required check on the
     branch protection rule.
   * **Per-PR matrix (optional, opt-in via `ci:e2e-matrix` label)**: same
     Playwright suite on `macos-latest` and `windows-latest`, no `xvfb`
     needed. Skipped by default to keep PR latency low; flipped on for any
     PR that touches `electron.vite.config.js`, `src/background.js`,
     `src/preload.js`, or anything under `build/`. Enforced via a
     `paths`/`labels` filter, not human discipline.
   * **Pre-tag / chase day**: the existing release matrix job runs the full
     Playwright suite on all three OSes *before* `electron-builder` publishes,
     and aborts the release if any e2e test fails. This is the gate that
     catches macOS/Windows regressions the per-PR Linux run can't see.
   * **Nightly**: a scheduled workflow (`cron: '0 3 * * *'`) runs the full
     three-OS Playwright matrix against `main` so regressions surface
     overnight even if no PR triggered them.
8. Add **Dependabot** (`.github/dependabot.yml`) with grouped ecosystems:
   `electron-*`, `vue-*`, `eslint-*`, `babel-*`, `vite-*` (placeholder),
   `sentry-*`, `tailwind-*`. Weekly schedule.
9. Add `npm audit --omit=dev --audit-level=high` as a non-blocking job.

### Chase day (M0 close)

* Tag `v1.4.0-rc.0` on a branch, run the full release matrix manually
  (`workflow_dispatch`). Required to pass on each runner *before*
  `electron-builder` publishes:
  * `npm test -- --coverage`
  * `npx playwright test` (Linux uses `xvfb-run`)
  * `npm run electron:build` (release target for that OS)
* Confirm macOS dmg + Windows nsis + Linux AppImage all produce, and that
  the boot Playwright spec passes on all three. No code changes.
  Cut **`v1.4.0`**.

### Exit criteria

* Coverage threshold ≥ baseline; PR fails if it drops.
* Playwright boot + IPC test green on Linux.
* Linux AppImage builds on every PR.
* Dependabot configured and producing PRs.

---

## M1 — Surgical replacements (no toolchain change)

**Goal**: kill the dead/deprecated direct deps that don't need the toolchain
swap. Stays on Node 16 and Vue CLI.

### Sandbox-runnable steps

1. **`request` → `got@11.8.x`**
   * `got@11` is the last CommonJS-compatible major; later majors are
     ESM-only and need Node ≥ 18, so we'll bump again in M3.
   * Replace the implementation inside `src/http-client.js` from M0; nothing
     else changes.
   * Map options: `url` → `url`, `headers` → `headers`, `json: true` → use
     `responseType: 'json'`, `timeout` → `timeout: { request: 30_000 }`,
     callback `(error, response)` → `try { const r = await got(...) }`.
   * Map retry logic: `got` has built-in `retry`, but `clickup-service.js`
     has its own `withTimeoutAndRetry` wrapper — disable `got`'s retry
     (`retry: { limit: 0 }`) to avoid double-retrying.
   * Tests already in M0 lock the contract.
2. **`electron-notarize` → `@electron/notarize`**
   * Update `notarize.js`: `require('electron-notarize')` → `require('@electron/notarize')`.
   * `electron_notarize.notarize({ appBundleId, appPath, appleId, appleIdPassword })`
     → `notarize({ tool: 'notarytool', appBundleId, appPath, appleId, appleIdPassword, teamId })`.
   * Add `APPLE_TEAM_ID` to `env.example` (already half-present) and to the CI
     secret list. Re-enable `afterSign: './notarize.js'` in `vue.config.js`.
3. **`babel-eslint` → `@babel/eslint-parser`**
   * Update `package.json` `eslintConfig.parserOptions.parser`.
   * Bump `eslint` from 7 to **8** (not 9 yet — ESLint 9 needs the flat
     config migration which we'll do in M4 alongside the Vue ecosystem).
   * `eslint-plugin-vue` already on 9, compatible.
4. **`electron-builder` cleanup**
   * Remove the duplicate from `dependencies` (keep only in `devDependencies`).
   * Bump electron-builder 23 → **24** (still works with vue-cli-plugin-electron-builder
     via the existing `overrides`). No 26 yet — that's an M3 step paired with the
     Electron major bump.
5. **Sentry**: keep at v4 in this milestone; we have no reason to disturb it.

### Chase day (M1 close)

* Build and sign on macOS + Windows runners via tag push. Verify notarization
  succeeds on macOS (this is the highest-risk step of M1). Cut **`v1.5.0`**.

### Exit criteria

* `package-lock.json` no longer contains the `request` package.
* Notarized macOS dmg downloads cleanly without Gatekeeper warnings.
* No new ESLint warnings introduced.

---

## M2 — Vite migration (drop Vue CLI + webpack 4)

**Goal**: free the project from Node 16 / webpack 4 / OpenSSL legacy. Still on
Electron 21, still on Node 16 *for this milestone* (we'll bump Node in M3 to
keep the change set scoped).

### Sandbox-runnable steps

1. **Choose the bundler integration**: **`electron-vite`**
   (https://electron-vite.org). It's the most mature Vite-based scaffold for
   electron-builder users; treats `main`, `preload`, and `renderer` as three
   separate Vite builds. Alternative: `vite-plugin-electron`. Pick
   `electron-vite` unless something pushes back during the spike.
2. Spike the migration on a throwaway branch:
   * `npm install -D electron-vite vite @vitejs/plugin-vue`.
   * Create `electron.vite.config.js` with three entries pointing at
     `src/background.js` (main), `src/preload.js` (preload), `src/main.js`
     (renderer).
   * Replace `vue.config.js` with the equivalent electron-builder config block
     in `package.json`'s `build` field (where electron-builder natively reads
     it). Move `mac`/`mas`/`linux` blocks verbatim.
   * Adjust `src/background.js`: replace `process.env.WEBPACK_DEV_SERVER_URL`
     with `process.env.ELECTRON_RENDERER_URL` (electron-vite's equivalent),
     and `createProtocol('app')` from `vue-cli-plugin-electron-builder/lib`
     with electron-vite's protocol helper or the standard
     `protocol.registerFileProtocol`.
   * Replace `@/` path aliases (currently configured by `@vue/cli-service`)
     with explicit Vite `resolve.alias`.
   * Replace `vue-cli-service electron:serve` and `vue-cli-service electron:build`
     in `package.json` with `electron-vite dev` and
     `electron-vite build && electron-builder` respectively.
3. Re-run the M0 test suite end to end on Linux: lint, vitest, Playwright,
   `electron-builder --linux`. Fix everything that broke.
4. Drop `@vue/cli-service`, `@vue/cli-plugin-babel`, `@vue/cli-plugin-eslint`,
   `@vue/cli-plugin-router`, `vue-cli-plugin-electron-builder`, `babel.config.js`,
   `vue.config.js`, the `overrides` block, and `core-js` (Vite uses esbuild for
   transpiling, no core-js polyfill needed for an Electron renderer).
5. Tailwind/PostCSS: keep `tailwindcss` 3 + `postcss` + `autoprefixer` in
   `postcss.config.cjs` so Vite picks them up. Tailwind 4 is M4.
6. Sass: `sass-loader` is gone (webpack-only); just keeping `sass` is enough —
   Vite invokes it directly via `vite-plugin-vue`.
7. Remove the `Node/OpenSSL error (error:0308010C)` section from
   `docs/development.md` — the constraint is dead.

### Chase day (M2 close)

* `dist_electron/` macOS dmg, Windows nsis, Linux AppImage all produce.
* Manual smoke: open each artifact, log in with a test ClickUp token, drag a
  calendar entry, confirm Sentry receives a fake error from a `Test crash`
  menu item (or temporarily expose one).
* Cut **`v1.6.0`**.

### Exit criteria

* `vue.config.js`, `babel.config.js`, all `@vue/cli-*` packages removed.
* `npm run dev` (renamed from `electron:serve`) and `npm run build:linux`
  finish in < ½ the previous time.
* Boot Playwright test still green.

---

## M3 — Node 20 + Electron major + Sentry 7

**Goal**: the big platform bump. This milestone is the most likely to surface
runtime regressions; M0 tests are the safety net.

### Sandbox-runnable steps

1. **Node 16 → 20 LTS**
   * `.nvmrc` → `v20.x`. CI matrix `node-version: 20`.
2. **`got` 11 → latest** (now ESM-only and Node 18+, fine on 20).
3. **`electron` 21 → 30** (last major that still ships under the 1-year
   stable window when this plan is executed; pick whatever is current LTS
   when you start). Read the per-major breaking-change notes. Likely
   touchpoints:
   * `nodeIntegration: true` is increasingly hostile; we currently enable
     it. Optional follow-up: scope IPC through `contextBridge` in `preload.js`
     and disable nodeIntegration. Out of scope for M3 *unless* the chosen
     Electron version requires it.
   * `BrowserWindow.openDevTools()` flags, `app.whenReady()` semantics, etc.
4. **`electron-builder` 24 → 26**.
5. **`electron-store` 8 → 11** (now ESM-only). Either:
   * Use dynamic `import('electron-store')` inside `src/store.js` and
     `src/cache.js`, *or*
   * Convert `src/store.js` and `src/cache.js` into ESM modules (Vite's
     renderer is already ESM; main process under electron-vite supports ESM
     too).
6. **`electron-updater` 5 → 6** — minor API drift around `autoUpdater.checkForUpdatesAndNotify`.
7. **`electron-devtools-installer` 3 → 4**.
8. **`@sentry/electron` 4 → 7**:
   * `init({ debug, dsn })` API still works but recommended preset has changed
     — review the v5 → v6 → v7 migration guides in order.
   * Re-run `sentry-symbols.js` against the new Electron version. Wire it
     into the release pipeline as a post-build step (currently it's a manual
     script).
   * **Drop branch (alternative)**: if you decide to remove Sentry, instead
     delete `@sentry/electron`, `@sentry/cli`, `electron-download`, the
     init blocks at `src/background.js:3-8` and `src/main.js:1-3`,
     `src/preload.js`, `notarize.js` is unaffected. `sentry-symbols.js` and
     `sentry.properties` get deleted. M3 estimate shrinks by half a day.
9. Update Playwright: assert that the renderer mounts under the new Electron
   major, and that `electron-store` reads/writes still round-trip a value.

### Chase day (M3 close)

* Run the full release matrix. macOS especially: a new Electron major often
  needs the Apple notarization tool re-pinned. Cut **`v2.0.0`** (major bump
  earned by Node + Electron jumps).

### Exit criteria

* All E2E tests green on Node 20 + Electron 30.
* `sentry-symbols.js` runs successfully against the new Electron version.
* `npm audit --omit=dev` reports no high-severity advisories.

---

## M4 — Vue / Tailwind / UI ecosystem

**Goal**: catch up on UI-layer majors that were artificially blocked by the old
toolchain.

### Sandbox-runnable steps

1. **Vue 3.2 → 3.5**, `@vue/compiler-sfc` matched. Read the 3.3, 3.4, 3.5
   release notes for SFC behavior changes (mostly additive).
2. **`vue-router` 4 → 4.6** (latest 4.x). Defer the brand-new 5.0 until the
   first patch release.
3. **`naive-ui` 2.40 → 2.44+**. Watch for component-prop deprecations.
4. **`chart.js` 4 → latest 4.x**, `vue-chartjs` 5 → latest 5.x.
5. **`@heroicons/vue` 2.1 → 2.2**, `@vicons/*` 0.12 → 0.13.
6. **Tailwind 3 → 4** (the heavy one):
   * Tailwind 4 drops `tailwind.config.js` in favor of CSS-first `@theme {}`
     and `@import "tailwindcss"` in the entry CSS.
   * Replace `postcss.config.cjs` content with the v4 `@tailwindcss/vite`
     plugin in `electron.vite.config.js`.
   * Re-derive any custom theme tokens from `tailwind.config.js` (currently
     trivial: just `content` paths, which become globs in the new
     `@source` directive or are auto-detected by the Vite plugin).
   * Visual smoke: load the calendar, settings page, statistics page,
     side-by-side screenshot diff against pre-upgrade. Add a Playwright
     screenshot snapshot test for the splash screen and one calendar view.
7. **ESLint 8 → 9 + flat config** (`eslint.config.js`, `eslint-plugin-vue` ≥ 10).
   Migrate the inline `eslintConfig` in `package.json` to flat config.
8. **`v-offline` 3.3 → 3.5**, **`lodash` 4.17 → 4.18**.

### Chase day (M4 close)

* Visual regression review on macOS and Windows (Linux already covered by
  Playwright snapshot diffs). Cut **`v2.1.0`**.

### Exit criteria

* No `tailwind.config.js`, no legacy ESLint config block in `package.json`.
* All Vue 3.5 deprecation warnings resolved.
* Playwright screenshot baselines updated.

---

## M5 — Node 22 LTS

**Goal**: track LTS. Should be quiet if M3 went well.

### Sandbox-runnable steps

1. `.nvmrc` → `v22.x`, CI matrix → 22.
2. Re-run vitest, Playwright, build:linux. Bump anything that complains.
3. Re-run `npm audit`.
4. Bump `@electron/notarize`, electron-builder, electron, Sentry, etc. to
   whatever's current.

### Chase day (M5 close)

* Cut **`v2.2.0`**.

### Exit criteria

* Node 22 green on all three platforms.

---

## M6 — Node 24 LTS (final target)

Same shape as M5, on Node 24. Cut **`v2.3.0`**.

After M6, there's no further planned bump — Dependabot keeps minor/patch
upgrades flowing through the M0 gates, and the assistant can land most of those
PRs autonomously after a quick human review.

---

## What the assistant can do without a human

The vast majority of this plan runs in a sandbox. The assistant should:

* Land every M0 step and most of M1, M2, M4 end-to-end. Each step:
  branch → change → run lint + vitest + Playwright + `build:linux` → push → PR.
* Open, but **not merge**, M3 / M5 / M6 PRs — those need a human to validate
  signed/notarized release artifacts on chase day.
* Surface "this is risky, hand off" when:
  * A test it can't write would be needed (e.g. signed-installer behavior).
  * A lockfile change pulls in something new at a non-trivial scale (e.g. a
    new transitive package > ~5 MB or with native bindings).
  * `npm audit` reports a high-severity advisory it can't auto-resolve.

## What still needs a human

1. **Code-signing identities and notarization**: Apple developer cert, Windows
   EV cert, Apple Team ID, Sentry DSN. CI already injects these; the assistant
   never sees them.
2. **Manual UI smoke** on macOS and Windows on chase day — the screenshot
   diffs catch obvious regressions but font rendering, modifier-key shortcuts,
   tray-icon behavior, and the macOS title bar don't reliably surface in
   Playwright.
3. **Sentry symbol upload** post-Electron-major-bump (one command, but it
   requires the Sentry CLI auth token).
4. **Decision on `nodeIntegration`** during M3 — the safer
   `contextBridge`-only setup is a behavior change that touches every
   `ipcRenderer` call in the renderer (~17 sites). Worth its own follow-up
   milestone after M6.

## Open follow-ups (out of scope here)

* Migrate to TypeScript (zero current types). Pairs naturally with the Vite
  move; deferred so this plan stays about *upgrading* not *rewriting*.
* Replace the home-grown `withTimeoutAndRetry` wrapper in `clickup-service.js`
  with `got`'s native retry once the test mock layer locks behavior.
* Drop `nodeIntegration: true` and route all main↔renderer traffic through
  `contextBridge` in `preload.js`.
* Replace `electron-store` with `conf` directly (electron-store wraps it) if
  ESM friction outweighs the convenience.

## Appendix: dependency-by-dependency target

| Package | Current | Target (final) | Lands in |
|---|---|---|---|
| node | 16.20.2 | 24 LTS | M3 → M5 → M6 |
| electron | 21 | latest stable | M3, M5, M6 |
| electron-builder | 23 | latest | M1, M3, M5 |
| electron-store | 8 | latest (ESM) | M3 |
| electron-updater | 5 | latest | M3 |
| electron-devtools-installer | 3 | latest | M3 |
| electron-notarize | 1.2 | `@electron/notarize` latest | M1 |
| @sentry/electron | 4 | 7+ | M3 |
| request | 2.88 (transitive direct-import) | removed | M1 |
| got | — | latest | M1 (v11), M3 (latest) |
| @vue/cli-service & plugins | 5.0.8 | removed | M2 |
| vue-cli-plugin-electron-builder | 2.1.1 | removed | M2 |
| webpack | 4 (transitive) | removed | M2 |
| vite + electron-vite | — | latest | M2 |
| vue | 3.2.45 | 3.5 | M4 |
| vue-router | 4.1 | 4.6 (5.x deferred) | M4 |
| naive-ui | 2.40 | latest 2.x | M4 |
| chart.js | 4.4 | latest 4.x | M4 |
| vue-chartjs | 5.3 | latest 5.x | M4 |
| vue-cal | 4.8 | latest 4.x | M4 |
| @heroicons/vue | 2.1 | 2.2 | M4 |
| @vicons/* | 0.12 | 0.13 | M4 |
| tailwindcss | 3.2 | 4.x | M4 |
| postcss / autoprefixer | 8.4 / 10.4 | latest | M2 (Vite), M4 |
| sass / sass-loader | 1.56 / 13 | latest sass; loader removed | M2 |
| eslint | 7 | 9 (flat config) | M1 (→8), M4 (→9) |
| eslint-plugin-vue | 9.1 | 10.x | M4 |
| babel-eslint | 10 | `@babel/eslint-parser` (then removed) | M1, M2 |
| core-js | 3.26 | removed | M2 |
| lodash | 4.17 | 4.18 | M4 |
| v-offline | 3.3 | 3.5 | M4 |
| remove-accents | 0.5 | 0.5 (unchanged) | — |
| dotenv | 16 | latest | M1 |
| vitest | 0.34 | latest | M0 (with coverage) |
