# Building from Source

## Prerequisites
- **Node.js** 16.20.2 or compatible version (check `.nvmrc`)
- **npm** (comes with Node.js)

You can use [nvm](https://github.com/nvm-sh/nvm) to manage Node.js versions:
```bash
nvm install
```

## Installation
Install project dependencies:
```bash
npm install
```

## Development
To run the app in development mode with hot-reload:
```bash
npm run electron:serve
```

## Building for Production
Build for your current platform:
```bash
# macOS
PYTHON=python3 npm run build:osx

# Windows
npm run build:win

# Linux
npm run build:linux

# All platforms
npm run build:all
```

Built applications will be available in the `dist_electron` directory.

## Other Commands
- **Lint**: `npm run lint`
- **Test**: `npm run test`
- **Watch tests**: `npm run test:watch`

For more development information, see the [development guide](./docs/development.md).
