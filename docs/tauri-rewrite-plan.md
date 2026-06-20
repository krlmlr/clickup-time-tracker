# Tauri Rewrite Plan

Companion to [`dependency-upgrade-plan.md`](./dependency-upgrade-plan.md). The
upgrade plan covers staying on Electron; this one covers replacing it with
Tauri. The two share a foundation: the test corpus added in M0 / R0 is
identical and reusable either way, which is why doing R0 first is a no-regret
move.

## What is Tauri

Tauri is a framework for building desktop apps where:

* the **frontend** is any web stack (here: Vue 3 + Vite, the same Vue
  components that ship today),
* the **backend** is **Rust**, exposed to the frontend through type-checked
  async commands (`#[tauri::command]` on the Rust side, `invoke('name', args)`
  on the JS side — the replacement for Electron's `ipcMain` / `ipcRenderer`),
* the **runtime** is the host OS's existing webview — WKWebView on macOS,
  WebView2 on Windows, `webkit2gtk` on Linux — instead of a bundled Chromium.

That last bullet is what changes the resource profile. A typical Tauri app is
**~5–10 MB on disk and ~30 MB idle RAM**, against ~120 MB / ~300 MB for an
equivalent Electron app, because Chromium is no longer in the bundle.

What Tauri gives you out of the box (each gated by an allowlist for security):
file system, dialogs, OS notifications, system tray, menus, shell, an updater
plugin, an encrypted storage plugin (`tauri-plugin-stronghold`), a key-value
store plugin (`tauri-plugin-store`), and logging. Tauri 2.x is the current
major and additionally targets iOS and Android.

License: MIT/Apache, no per-seat fee. Ecosystem is smaller than Electron's but
mature for the surface this app uses.

## Why it fits the "AI as code owner" goal

* **Smaller surface** — the dependency tree shrinks by roughly half once
  electron-builder, electron-store, electron-updater, `@electron/notarize`,
  electron-devtools-installer, vue-cli-plugin-electron-builder, and
  `@sentry/electron` come out.
* **Sandbox-runnable build** — `cargo tauri build --target
  x86_64-unknown-linux-gnu` produces AppImage / deb / rpm on `ubuntu-latest`
  with no FUSE quirks. `cargo tauri dev` boots under `xvfb-run`.
* **One signing surface** (macOS only, if you choose to ship there). No
  Windows code-signing burden unless you decide you want it.
* **Type-checked IPC** — the contract between JS and the backend is generated
  from Rust types (via `specta` or `tauri-specta`), so an agent breaking the
  shape of a command gets caught at compile time instead of at runtime.
* **Faster CI feedback loop** — Rust compile + small bundle is dominated by
  the Rust step, but cached `cargo` builds finish a Linux release in 2–3 min
  on a hosted runner; Electron release builds take 6–10 min.

## Test-driven rewrite: can the existing app define the tests?

**Yes — most layers carry over verbatim, one layer needs a launcher swap, one
needs to be rewritten.** The trick is to add the test corpus to the *current*
repo first (R0, identical to M0 of the upgrade plan), then start the Tauri
repo with that corpus already red.

### Test layer reuse matrix

| Layer | What it tests | Reuse in Tauri |
|---|---|---|
| **HTTP fixtures** (`tests/fixtures/clickup/*.json`) | Real-shaped ClickUp API responses, sanitized | **100% reusable** — they're just JSON. Both Electron MSW tests and Tauri Rust tests (via `wiremock-rs` or `httpmock`) consume the same files. |
| **Pure JS unit tests** (`task-search.test.js`, future `events-factory.test.js`, `time-utils.test.js`, `helpers.test.js`) | Logic that has no electron / tauri import | **100% reusable** — copy the modules and tests as-is into the Tauri repo. Vitest works the same. |
| **`clickup-service.js` MSW tests** | The HTTP-calling service against fake responses | **100% reusable if `clickup-service.js` stays in JS**, or **0% reusable if ported to Rust** — in which case the *fixtures* are still reusable, but the tests rewrite as Rust integration tests against `wiremock-rs`. The recommended path is "port to Rust", which means re-expressing the same scenarios; the test list and fixtures transfer, the test code does not. |
| **IPC / command contract tests** (new, JSON-driven) | "Channel `get-clickup-hierarchy` with input X replies on `set-clickup-hierarchy` with shape Y" | **100% reusable.** Write a contract runner that reads `tests/contracts/*.json` and dispatches to the platform-appropriate transport — `ipcRenderer.send` in Electron, `invoke` in Tauri. The contract files don't change. |
| **Vue component tests** (new, Vitest + Vue Test Utils) | Components in isolation, props/emits/slots | **100% reusable.** Components mount in jsdom, no electron/tauri import involved. |
| **Playwright user-journey tests** | "Click the calendar at 09:00, drag to 10:30, expect a TimeEntryCreatorForm with start=09:00" | **~95% reusable.** Test bodies (selectors, typed text, assertions) carry over because they're DOM-level. Only the *launcher fixture* swaps: `playwright._electron.launch(...)` → `tauri-driver` + WebDriverIO **or** point Playwright at the dev URL when running against `tauri dev` (Tauri's renderer is a normal webview talking to the Vite dev server). Use `data-testid` selectors throughout; avoid asserting on Electron-specific window chrome. |
| **Visual regression baselines** | Screenshot diffs | **Re-baseline required.** Different webview engines render fonts and antialiasing differently. Acceptable cost. |

### How TDD works in practice

**Step 1: build the corpus in the current repo (R0 / M0)**

This is the same work whether or not Tauri happens, which is why it's a safe
investment.

1. Add the recorder + sanitizer (see `dependency-upgrade-plan.md`'s "Mock
   data collection" section). Commit sanitized fixtures to
   `tests/fixtures/clickup/`.
2. Write Vitest unit tests for `task-search.js` (already done),
   `events-factory.js`, `time-utils.js`, `cache.js`, and `helpers.js`. None
   of these care about Electron.
3. Write MSW-backed tests for `clickup-service.js` against the fixtures.
4. **Define the IPC contract format**:
   `tests/contracts/<channel>.json` shape:
   ```json
   {
     "channel": "get-clickup-hierarchy",
     "request": {},
     "fixtureSetup": ["hierarchy-happy-path"],
     "expectedReplyChannel": "set-clickup-hierarchy",
     "expectedReply": { "$ref": "../fixtures/clickup/hierarchy.expected.json" }
   }
   ```
   Add a runner `tests/contracts/run.js` that, given a transport
   (`electron-ipc` or `tauri-invoke`), executes every contract file and
   asserts. In the current repo, only the Electron transport exists; in the
   Tauri repo, both will be implementable, and during transition the same
   contracts gate both.
5. Write Vue component tests for the components that have non-trivial logic
   (`TaskCreatorForm.vue`, `TimeEntryCreatorForm.vue`,
   `TimeTrackingStatistics.vue`, `MemberSelector.vue`).
6. Write Playwright user-journey tests **with launcher abstraction**:
   ```js
   // tests/e2e/journeys/create-time-entry.spec.js
   import { test, expect } from '../fixtures/launcher.js';

   test('create a time entry by dragging on the calendar', async ({ page }) => {
     await page.getByTestId('calendar').waitFor();
     // ... DOM-only interactions, no electron/tauri imports
   });
   ```
   The `launcher.js` fixture decides whether to launch Electron or Tauri
   based on `TEST_TARGET=electron|tauri`. In R0 only `electron` exists.
   Add `data-testid` attributes to every component the tests touch.

By the end of R0 the current Electron app has a meaningful safety net **and**
a portable test corpus.

**Step 2: scaffold the Tauri repo with the corpus already failing (R1)**

The corpus is brought into the new repo by `git subtree` from the existing
repo (cleaner: publish a tiny `@clickup-time-tracker/test-corpus` workspace
package with fixtures and contracts). The Tauri repo's CI runs the corpus
against an empty Tauri app; everything fails.

**Step 3: red → green, contract by contract (R2…R5)**

Each milestone takes a slice of the corpus from red to green:

* R2 makes pure-JS unit tests pass (lift the modules unchanged).
* R3 makes settings/cache contract tests pass (port `cache.js` and `store.js`
  to `tauri-plugin-store`).
* R4 makes ClickUp HTTP contract tests pass (Rust port of `clickup-service`,
  fixtures served by `wiremock-rs`).
* R5 makes user-journey tests pass (the renderer is wired up end-to-end).

This is genuinely TDD: every Tauri PR's job is to flip a specific contract or
journey from red to green; "done" is not subjective.

### What can't be reused as tests

* Visual baselines (re-take after R5).
* Anything asserting on Electron menu strings or window chrome.
* Anything that pokes at `process.env.WEBPACK_DEV_SERVER_URL` or
  Electron-specific globals.
* Sentry-electron specific assertions (Sentry-browser has different
  breadcrumb shapes).

These are small enough to rewrite per-test as they come up.

## Architecture mapping: Electron → Tauri

| Today (Electron) | Tomorrow (Tauri) | Notes |
|---|---|---|
| `src/background.js` | `src-tauri/src/main.rs` + `src-tauri/src/commands/*.rs` | Each `ipcMain.on('foo', ...)` becomes a `#[tauri::command] fn foo(...)`. |
| `src/preload.js` | not needed | No nodeIntegration / contextBridge ceremony. JS in the renderer cannot reach OS APIs except through `invoke`. |
| `src/store.js` (electron-store) | `tauri-plugin-store` (or `tauri-plugin-stronghold` for the access token) | Token in stronghold is OS-keyring-backed encryption — strictly better than today's electron-store-on-disk. |
| `src/cache.js` (electron-store with TTL) | Thin Rust module over `tauri-plugin-store` keeping the same `cache.values.<k>` / `cache.expires_at.<k>` shape | Contract test gates the migration. |
| `src/clickup-service.js` (~ 1000 lines, JS + `request`) | `src-tauri/src/clickup/*.rs` using `reqwest` | Rust port is the biggest chunk of net-new code. ~700–1000 lines of Rust estimated. |
| `src/app-menu.js` | Tauri menu builder (Rust) | Mostly declarative. macOS keyboard shortcut handling moves into the menu accelerators. |
| `src/app-updater.js` (electron-updater) | `tauri-plugin-updater` | Requires a signing key pair; updater config points at GitHub Releases the same way. |
| `@sentry/electron` (main + renderer + preload) | `@sentry/browser` in renderer + optional `sentry` Rust crate panic hook | First-pass v3.0.0 ships renderer-only Sentry; Rust panic hook is a follow-up. |
| `notarize.js` (afterSign hook) | `tauri.conf.json` `bundle.macOS.signingIdentity` + `--sign` flag, `notarytool` invoked by Tauri's bundler | One config block; no afterSign script. |
| `electron-builder` | `cargo tauri build` + `tauri.conf.json` `bundle` block | AppImage / deb / rpm / dmg / nsis all supported. |
| Vue 3 components (`src/components/**`, `src/views/**`) | **lifted unchanged** | Only IPC call sites change: `ipcRenderer.send('foo', ...)` → `await invoke('foo', { ... })`. ~17 sites. |
| `src/router/` | unchanged | vue-router 4 works as-is. |
| `src/main.js`, `src/App.vue` | unchanged except removing the Sentry-electron init line | |
| `tailwind.config.js` + `postcss.config.js` | unchanged through R5; Tailwind 4 migration is its own story (mirrors upgrade plan M4) | |

## Milestones

Each milestone produces something runnable and tested. Linux-first per
milestone; macOS chase day at R7.

```
R0  Test corpus in current repo                   shared with upgrade-plan M0
R1  Tauri scaffold + corpus wired up red          ~3 days
R2  Pure-JS modules ported, unit tests green      ~2 days
R3  Settings & cache: tauri-plugin-store          ~3 days
R4  ClickUp HTTP service in Rust                  ~7–10 days, the heaviest slice
R5  Renderer + IPC wired end-to-end               ~5 days, journeys go green
R6  Linux release (v3.0.0-rc.1)                   ~2 days, AppImage published
R7  macOS chase day (v3.0.0)                      ~2 days, requires Mac runner
R8  Windows release (optional)                    ~2 days, requires signing cert
```

End-to-end estimate: **4–7 weeks** for one engineer + assistant. Faster than
the upgrade because each step is bounded ("flip these N contracts green") and
because Linux + macOS sandbox loops are clean.

### R0 — Test corpus in current repo

Identical to M0 of the upgrade plan. Do this *first*, regardless of which
fork you choose. Output: fixtures, contracts, vitest unit + component tests,
launcher-agnostic Playwright journeys.

### R1 — Tauri scaffold + corpus wired up

Sandbox-runnable end-to-end.

1. New top-level directory `tauri/` (or new repo `clickup-time-tracker-tauri`
   — pick the simpler one; mono-repo is easier for keeping the corpus in
   sync).
2. `npm create tauri-app@latest -- --template vue` (Tauri 2, Vue, Vite, JS).
3. Copy `src/components/`, `src/views/`, `src/router/`, `src/assets/`,
   `src/App.vue`, `src/main.js`, `src/utils/`, `src/model/`, `tailwind.config.js`,
   `postcss.config.js`. **Don't** copy `background.js`, `preload.js`,
   `app-menu.js`, `app-updater.js`, `clickup-service.js`, `cache.js`,
   `store.js` — those are the parts being rewritten.
4. Replace every `ipcRenderer.send / .on / .invoke` call with a stub
   `invoke('command_name', args)` whose Rust counterpart returns
   `Err("not yet implemented")`. The renderer compiles; everything errors at
   runtime.
5. Bring the `@clickup-time-tracker/test-corpus` workspace in. Wire CI to
   run the contract runner with `TEST_TARGET=tauri`.
6. CI on `ubuntu-latest`:
   ```
   npm ci
   cargo install tauri-cli --locked   # cached
   cargo tauri build --target x86_64-unknown-linux-gnu --debug
   xvfb-run -a npm test                       # vitest
   xvfb-run -a npm run test:contracts          # red across the board
   xvfb-run -a npx playwright test             # red, app boots though
   ```

**Exit criteria**: app launches, splash screen mounts, every contract test is
red with a precise "not implemented" message, the boot Playwright test
passes.

### R2 — Pure-JS modules

1. Lift `task-search.js`, `events-factory.js`, `time-utils.js`, `helpers.js`
   verbatim. Their vitest tests pass.
2. Add component tests as needed for any component that calls into these
   modules, to fence regressions.

**Exit criteria**: pure-logic vitest suite green; ~10–15% of contracts still
red.

### R3 — Settings & cache

1. Add `tauri-plugin-store` (renderer + Rust).
2. Implement Rust commands `cache_get`, `cache_put`, `cache_clear`,
   `cache_flush`, `cache_all`, mirroring the JS API. Token storage moves to
   `tauri-plugin-stronghold` for encryption-at-rest.
3. Implement settings get/set commands.
4. Migrate any UserSettings.vue calls from `ipcRenderer` to `invoke`.

**Exit criteria**: cache + settings contract tests green; renderer can read
and write user settings.

### R4 — ClickUp HTTP service in Rust

The biggest slice. Plan the work with one PR per endpoint group:

1. `clickup::user` — `tokenValid`, `getCurrentUserId`.
2. `clickup::hierarchy` — `getSpaces`, `getFolders`, `getLists`, `getTasks`,
   the full and filtered hierarchy assembly.
3. `clickup::tasks` — `getTask`, `createTask`, `updateTask`, `deleteTask`,
   task search fallback.
4. `clickup::time_entries` — `getTimeEntries`, `addTimeEntry`,
   `updateTimeEntry`, `deleteTimeEntry`.
5. `clickup::cache_warmer` — the background pre-load logic from
   `background.js:155-170`.

Each PR:

* Adds a Rust module with `reqwest` + serde structs.
* Adds Rust integration tests against `wiremock-rs` consuming the same
  fixtures the JS MSW tests use.
* Flips the relevant contract tests from red to green.
* Re-uses the `withTimeoutAndRetry` policy: easier in Rust with `tower::retry`
  or `reqwest-retry`, no need for the hand-rolled wrapper.

**Exit criteria**: every ClickUp contract green. App fully functional in the
sandbox using only mock fixtures.

### R5 — Renderer + IPC wired end-to-end

1. Replace every `invoke('command_name')` stub site (~17) with the real
   call.
2. Update `OnlineStatusProvider.vue` to use Tauri's `os::network` API or
   the renderer's standard `navigator.onLine` (probably the latter, no IPC
   needed).
3. App menu: build with Tauri's menu API, port the macOS keyboard shortcuts.
4. Auto-updater: `tauri-plugin-updater` configured against GitHub releases.
5. Sentry: `@sentry/browser` in `main.js`, identical DSN.

**Exit criteria**: every Playwright user-journey test green on Linux. App is
feature-complete on Linux.

### R6 — Linux release

1. `cargo tauri build --bundles appimage,deb,rpm`.
2. Cut **`v3.0.0-rc.1`**. Publish to a separate "preview" GitHub release;
   don't disturb the existing 1.x download links yet.
3. Internal smoke testing.

**Exit criteria**: Linux artifacts download and run; auto-updater reaches
the preview release channel.

### R7 — macOS chase day

1. Hook a macOS runner. Tauri's bundler invokes `notarytool` natively; no
   `notarize.js` script.
2. Configure `signingIdentity`, set `APPLE_ID` / `APPLE_ID_PASSWORD` /
   `APPLE_TEAM_ID` secrets.
3. `cargo tauri build --bundles dmg --target aarch64-apple-darwin` and
   `--target x86_64-apple-darwin`.
4. Universal dmg via `tauri.conf.json` macOS bundle option.
5. Cut **`v3.0.0`**. Update README to point at the Tauri release; archive
   the v1.x branch.

**Exit criteria**: notarized dmg available; Sentry receives a test crash
from the new bundle; download URL announced.

### R8 — Windows release (optional)

If the maintainer wants Windows: Tauri's MSI / NSIS bundler, EV cert for
SmartScreen reputation. Otherwise skip — the PWA route would have skipped it
too, and current Windows users keep the v1.x signed builds working.

## Risks and unknowns

* **System webview parity**: `naive-ui`, `vue-cal`, and `chart.js` all assume
  modern browsers. WebKitGTK on Linux can lag Safari by several months on CSS
  / `Intl` features. Spike R1 includes loading every existing view to
  surface incompatibilities early.
* **Tauri 2 maturity**: Tauri 2.x is stable as of 2024 but the plugin
  ecosystem is younger than Electron's. The plugins this app needs
  (`store`, `stronghold`, `updater`, `log`) are all first-party and shipped
  with Tauri 2.
* **Rust learning curve**: not zero. AI assistants handle Rust well, and the
  scope here (HTTP client + a key-value store + a few commands) is among the
  easiest Rust use cases. Budget a buffer in R4 for compile-time learning
  during human review.
* **`tauri-driver` flakiness**: Tauri's WebDriver bridge has historically
  been less polished than Playwright's Electron driver. Mitigation: prefer
  the "point Playwright at the running `tauri dev` URL" approach for
  Linux CI; use `tauri-driver` only for the small set of tests that need
  to assert on native window state.
* **Settings migration on first run for existing users**: a Tauri v3.0.0
  build won't read `electron-store`'s file by default. Either ship a
  one-time migrator that reads the legacy JSON file path or ask users to
  re-enter their token. Decide before R6.
* **GitHub Releases collision**: the existing `electron-updater` clients
  expect specific filename patterns. Tauri's updater uses different ones.
  Either run the two on separate release tracks (recommended for clean
  split) or write a compatibility shim.

## Decision points before starting

These shape the work and want answers before R1:

1. **Mono-repo or new repo?** Mono-repo (`tauri/` subdirectory) makes the
   shared test corpus trivial; new repo is cleaner long-term. Default:
   mono-repo through R7, split at v3.0.0 if desired.
2. **Port `clickup-service.js` to Rust, or keep in JS?** Rust is the
   recommended path (smaller surface, type-checked HTTP, no `request` /
   `got` discussion). Keeping in JS shaves a week off R4 but keeps Node
   dependencies in the renderer.
3. **Token storage**: `tauri-plugin-store` (plaintext JSON, parity with
   today) or `tauri-plugin-stronghold` (encrypted, OS-keyring-backed).
   Recommended: stronghold for the access token, plain store for the rest.
4. **Sentry in Rust**: ship at v3.0.0 or follow-up? Recommended: v3.0.0
   ships browser-only Sentry; Rust panic hook is v3.1.0.
5. **Existing user migration**: write a migrator in R5, or accept that
   v3.0.0 users re-enter their ClickUp token? Migrator is ~1 day of work.

## Authentication: OAuth2 instead of personal access tokens

The current app pastes a ClickUp **personal access token** into a settings
field. The rewrite is the right time to move to **OAuth2**, which gives:

* Per-user, per-app authorization that the user can revoke from ClickUp's UI.
* No more "paste an opaque secret" UX.
* A standard audit trail for ClickUp.

ClickUp's OAuth flow is the standard authorization-code grant with a
confidential client — the `client_secret` must not appear in the desktop
binary or in the browser. (Verify against ClickUp's current docs;
PKCE-only public-client support is not present at the time of writing.)

### Flow shape for Tauri

```
[user clicks Connect]
   ↓
Tauri opens OS browser  →  https://app.clickup.com/api?client_id=…&redirect_uri=clickup-time-tracker://oauth/callback
   ↓
[user approves in ClickUp]
   ↓
Browser redirects to clickup-time-tracker://oauth/callback?code=…
   ↓
OS deep-link delivers URL to Tauri app  (tauri-plugin-deep-link)
   ↓
Tauri's Rust backend POSTs { code } to BFF /oauth/exchange
   ↓
BFF (holding client_secret) POSTs to ClickUp /oauth/token, gets access_token, returns it
   ↓
Tauri stores access_token in tauri-plugin-stronghold (OS-keyring-backed)
   ↓
All subsequent ClickUp calls: Tauri Rust → ClickUp API directly
```

Two non-Tauri parts are required:

1. **Register an OAuth app with ClickUp** — owner provides a publisher name,
   logo, and a public privacy policy URL. The repo's `PRIVACY.md` becomes
   the source for that URL once it's hosted.
2. **A tiny BFF endpoint** that holds the `client_secret` and performs the
   code-exchange. The same Worker can serve the PWA (see the upgrade plan's
   alternatives section) — one OAuth app, two clients, one Worker.

### BFF surface

About 50 lines of TypeScript on Cloudflare Workers:

```ts
// POST /oauth/exchange  { code }  →  { access_token }
//   - validates code
//   - posts to ClickUp /oauth/token with stored client_secret
//   - returns access_token to caller (no storage; caller owns the token)
```

That's it. No sessions, no KV, no per-user state. The Tauri app holds the
token in stronghold; the Worker is stateless.

### Token storage on-device

* **Access token**: `tauri-plugin-stronghold` (encrypted, OS-keyring-backed).
  Strictly better than today's `electron-store` plaintext file.
* **Refresh tokens**: ClickUp doesn't issue them at the time of writing
  (verify); access tokens are long-lived. If that changes, refresh handling
  goes in the same Rust module that owns the token.

### Test corpus implications

The OAuth integration adds new contracts:

* `auth.connect`: starts the flow, returns an authorization URL.
* `auth.exchange`: completes the flow given a code, returns success/failure.
* `auth.revoke`: removes the stored token.
* `auth.status`: returns connected user identity.

The MSW / `wiremock-rs` fixtures cover the `/oauth/token` endpoint with both
success and error responses; the BFF in dev runs as a local Worker
(`wrangler dev`) the e2e tests can point at.

### Effort delta

R4 grows by ~2 days (deep-link plumbing, BFF wiring, stronghold module). R5
grows by ~1 day (Connect-to-ClickUp UI, settings-page revocation control).
Total rewrite estimate **5–8 weeks**, up from 4–7.

### What we lose

Nothing of importance. The "paste a token" path can stay as a hidden fallback
behind a debug flag for one release, then remove it.

## Relationship to the upgrade plan

| Doing this | Implies for the upgrade plan |
|---|---|
| R0 first, then decide | Costs nothing — R0 == M0. Both forks benefit. |
| Pursue R1+, archive upgrade plan | Skip M2–M6. Keep M1 only if you want the v1.x line to receive a final security bump before sunset. |
| Pursue upgrade plan to M2, then pivot to Tauri | Vite migration (M2) doesn't help Tauri (Tauri's already on Vite). Wasted effort. |
| Pursue upgrade plan fully, never do Tauri | This document is informational. |

The cheapest committed path that keeps options open: **do R0, then evaluate
again with the corpus in hand**. By that point you'll know empirically how
much the existing app's logic costs to characterize, which is the strongest
signal for whether the upgrade or the rewrite is the better bet.
