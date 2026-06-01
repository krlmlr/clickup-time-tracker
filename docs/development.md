# Building & installing from source (macOS)

This guide walks you through building ClickUp Time Tracker from source on macOS
and installing the resulting app locally. It also covers running the app in
development mode.

> **Just want to use the app?** You don't need to build anything — grab the
> latest signed release from the
> [releases page](https://github.com/gwleuverink/clickup-time-tracker/releases).
> This guide is for contributors and people who want to build it themselves.

The instructions below are written for macOS. Linux and Windows builds are
possible too (see [Other platforms](#other-platforms)), but they aren't the
focus here and aren't regularly exercised outside of CI.

## Prerequisites

### Xcode Command Line Tools

Some dependencies contain native code that is compiled during install, so you
need a working compiler toolchain and `python3` (used by `node-gyp`). Install
Apple's Command Line Tools:

```bash
xcode-select --install
```

macOS ships with `python3`; verify it's on your `PATH`:

```bash
python3 --version
```

### Node.js via nvm (important: use the pinned, older version)

This project is **pinned to an older Node.js release** (`v16.20.2`, recorded in
[`.nvmrc`](../.nvmrc)). Newer Node versions **will not build the app** — see
[Troubleshooting](#nodeopenssl-error-error0308010c-when-bundling) for the
gory details. The recommended way to get exactly the right version without
disturbing the rest of your system is [nvm](https://github.com/nvm-sh/nvm)
(Node Version Manager).

1. Install nvm:

   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   ```

2. Load nvm into your current shell (or just open a new terminal). nvm's
   installer appends this snippet to your shell profile — `~/.zshrc` on a
   default modern macOS, or `~/.bash_profile` if you use bash:

   ```bash
   export NVM_DIR="$HOME/.nvm"
   [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
   ```

3. Confirm nvm works:

   ```bash
   nvm --version
   ```

4. From the project root, install and select the pinned version. With no
   argument, both commands read the version from `.nvmrc`:

   ```bash
   nvm install   # installs v16.20.2 as specified in .nvmrc
   nvm use       # switches the current shell to it
   ```

5. Verify you're on the expected version before continuing:

   ```bash
   node --version   # should print v16.20.2
   npm --version
   ```

> **Tip:** `nvm use` only applies to the current shell session. Re-run it (or
> set up nvm's [automatic `.nvmrc` switching](https://github.com/nvm-sh/nvm#deeper-shell-integration))
> whenever you open a new terminal to work on this project.

## Project setup

Install dependencies from the project root:

```bash
npm install
```

The `postinstall` step runs `electron-builder install-app-deps`, which rebuilds
native modules against Electron — this is why the Command Line Tools above are
required.

## Run in development mode

Compile and hot-reload the app for development:

```bash
npm run electron:serve
```

This launches the Electron app with live reload. Changes to source files are
reflected without a full rebuild.

To lint (and auto-fix) source files:

```bash
npm run lint
```

To run the test suite:

```bash
npm test
```

## Build the macOS app

Produce a distributable `.dmg` for macOS:

```bash
npm run build:osx
```

Under the hood this runs electron-builder via `vue-cli-service electron:build`
with `PYTHON=python3` set and `--mac=dmg`. The packaged app and installer are
written to the (git-ignored) `dist_electron/` directory:

- `dist_electron/time-tracker-<version>-mac-<arch>.dmg` — the installer
- `dist_electron/mac/ClickUp Time Tracker.app` — the unpacked app bundle

### Install the build locally

Open the generated `.dmg` and drag **ClickUp Time Tracker** into your
`Applications` folder, the same way you'd install any downloaded macOS app.

Because a locally built app is **not code-signed or notarized** by Apple,
Gatekeeper will refuse to open it on first launch. To run it anyway:

- Right-click (or Control-click) the app in `Applications` and choose **Open**,
  then confirm in the dialog, **or**
- After a blocked launch, go to **System Settings → Privacy & Security** and
  click **Open Anyway**.

You only need to do this once per build.

### Code signing & notarization (optional)

Signing and notarization are only needed if you intend to distribute the app to
other machines without the Gatekeeper prompt above. They are **not required**
for local builds.

The signing flow is driven by environment variables — copy
[`env.example`](../env.example) to `.env` and fill in the Apple credentials:

```bash
cp env.example .env
```

| Variable            | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `APPLE_ID`          | Apple ID used for notarization                       |
| `APPLE_ID_PASSWORD` | App-specific password for that Apple ID              |
| `APPLE_TEAM_ID`     | Team ID (used for Mac App Store / `build:mas` builds)|
| `VUE_APP_SENTRY_DSN`| Sentry DSN for error reporting (optional)            |

Notarization is wired up in [`notarize.js`](../notarize.js) (currently disabled
via the commented-out `afterSign` hook in [`vue.config.js`](../vue.config.js)).
Official release builds are signed and notarized automatically by CI; see
below.

## Troubleshooting

### Node/OpenSSL error (error:0308010C) when bundling

If you see an error like:

```
Error: error:0308010C:digital envelope routines::unsupported
```

you're almost certainly on a Node version newer than the pinned one. This
happens with Node.js >= 17, which bundles OpenSSL 3, in combination with the
older webpack used by `vue-cli-plugin-electron-builder`.

The fix is to use the pinned Node 16 release:

```bash
nvm use   # reads v16.20.2 from .nvmrc
```

Then verify with `node --version` and rebuild.

## Releases & CI

Official releases are built and published by GitHub Actions (see
[`.github/workflows/build.yml`](../.github/workflows/build.yml)), which builds
for macOS, Linux, and Windows on Node 16 and handles signing/notarization with
secrets stored in the repository.

To cut a release:

```bash
# Bump the version number in package.json first.
# The tag must start with `v` for CI to trigger a release build.

git commit -am "<VERSION_NUMBER>"
git tag <VERSION_NUMBER>
git push
git push --tags

# GitHub will build all platforms and create a draft release for review.
```

## Other platforms

Although this guide focuses on macOS, electron-builder can target Linux and
Windows as well (CI builds all three). The nvm + Node 16 prerequisite is the
same on every platform.

```bash
npm run build:linux   # AppImage (x64)
npm run build:win     # Windows installer (x64)
npm run build:all     # macOS + Windows + Linux
```

On Windows, install Node 16 with
[nvm-windows](https://github.com/coreybutler/nvm-windows/releases) instead of
the Unix nvm used above.

## Generating a new app icon

1. Install [electron-icon-builder](https://www.npmjs.com/package/electron-icon-builder)
   globally.
2. Replace the source icon at `./src/assets/images/icon/icon.png` (must be at
   least 1024×1024).
3. Generate the icon variants:

   ```bash
   electron-icon-builder --input=src/assets/images/icon/icon.png --output=build/icons --flatten
   ```

4. The new icon is picked up on the next build.
