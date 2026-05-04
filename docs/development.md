## Prerequisites

### Install nvm (Node Version Manager)

nvm allows you to easily manage multiple Node.js versions. Follow the instructions for your platform:

#### macOS/Linux

1. Download and install nvm:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
```

2. Close and reopen your terminal, or run:
```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

3. Verify installation:
```bash
nvm --version
```

#### Windows

1. Download and run the nvm-windows installer from: https://github.com/coreybutler/nvm-windows/releases
   - Download `nvm-setup.exe` and run it
   - Follow the installation wizard

2. Open a new PowerShell or Command Prompt window

3. Verify installation:
```bash
nvm --version
```

### Install Node.js

Once nvm is installed, install Node.js using the version specified in `.nvmrc`:

```bash
nvm install
nvm use
```

Verify installation:
```bash
node --version
npm --version
```

### Project setup
``` bash
npm install
```
### Compiles and hot-reloads for development
``` bash
npm run electron:serve
```

### Build for production
``` bash
npm run build:osx
npm run build:win
npm run build:linux
npm run build:all
```

### Node/OpenSSL error (error:0308010C) when bundling
If you see an error like:

```
Error: error:0308010C:digital envelope routines::unsupported
```

This happens with Node.js >= 17 using OpenSSL 3 and webpack 4 (used by vue-cli-plugin-electron-builder).

Switch to Node 16 LTS for development/builds (e.g., with nvm).

### Build & publish a new release
``` bash
# Increment the version number in package.json first
# Note that the version tag needs to start with `v` in order for CI to trigger a new build

git commit -am "<VERSION_NUMBER>"
git tag <VERSION_NUMBER>
git push
git push --tags

# Github will trigger a build. A draft release will be created for review
```

### Lints and fixes files
``` bash
npm run lint
```

### Generating a new app icon
1. Install [electron-icon-builder](https://www.npmjs.com/package/electron-icon-builder) globally
2. Replace the icon in `./src/assets/images/icon/icon.png` (must be at least 1024x1024)
3. Generate icon variants via the command line:

```
electron-icon-builder --input=src/assets/images/icon/icon.png --output=build/icons --flatten
```
4. The new icon will be used once a new build is triggered
