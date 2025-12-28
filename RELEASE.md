# Release Guide

This document covers how to create and publish releases for Note67.

## Prerequisites

### 1. Generate Signing Keys

Before your first release, generate a keypair for update signing:

```bash
npx @tauri-apps/cli signer generate -w ~/.tauri/note67.key
```

This creates:
- `~/.tauri/note67.key` - Private key (keep secret, never commit)
- Outputs public key to console

### 2. Configure Public Key

Add the public key to `src-tauri/tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/ZapYap-com/note67/releases/latest/download/latest.json"
      ],
      "pubkey": "YOUR_PUBLIC_KEY_HERE"
    }
  }
}
```

## Creating a Release

### 1. Bump Version

Use the bump script to update version across all config files:

```bash
./scripts/bump-version.sh 0.2.0
```

This updates:
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src/components/settings/constants.ts`

### 2. Update What's New

Edit `src/components/settings/UpdatesTab.tsx` and add a new entry to `recentChanges`:

```typescript
const recentChanges = [
  {
    version: "0.2.0",  // New release first
    date: "January 2025",
    changes: [
      "Feature 1",
      "Feature 2",
      "Bug fixes",
    ],
  },
  // ... older releases below
];
```

The bump script automatically:
- Commits all changes
- Creates the version tag
- Pushes to `development`
- Pushes `development` to `main`
- Pushes the tag

### 3. Build Release

```bash
# Set signing key environment variable
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/note67.key)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-password"

# Build for current platform
npm run tauri build
```

Build artifacts are located in:
- macOS: `src-tauri/target/release/bundle/dmg/` and `src-tauri/target/release/bundle/macos/`

### 5. Create GitHub Release

1. Go to GitHub → Releases → Draft a new release
2. Select the tag you just pushed (e.g., `v0.2.0`)
3. Upload build artifacts:
   - `.dmg` file (macOS installer)
   - `.app.tar.gz` file (macOS update bundle)
   - `.app.tar.gz.sig` file (signature)
   - `latest.json` file (update manifest)

### 6. Generate latest.json

Create `latest.json` for the updater:

```json
{
  "version": "0.2.0",
  "notes": "Release notes here",
  "pub_date": "2025-01-15T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "CONTENTS_OF_SIG_FILE",
      "url": "https://github.com/ZapYap-com/note67/releases/download/v0.2.0/Note67_0.2.0_aarch64.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "CONTENTS_OF_SIG_FILE",
      "url": "https://github.com/ZapYap-com/note67/releases/download/v0.2.0/Note67_0.2.0_x64.app.tar.gz"
    }
  }
}
```

Upload this file to the release assets.

## Versioning

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0): Breaking changes
- **MINOR** (0.1.0): New features, backwards compatible
- **PATCH** (0.0.1): Bug fixes

## Automated Releases (CI/CD)

Releases are automated via GitHub Actions. When you push a tag, the workflow:
1. Builds for macOS (both Apple Silicon and Intel)
2. Signs with Developer ID certificate
3. Notarizes with Apple
4. Creates a draft GitHub release with all artifacts

### Triggering a Release

```bash
./scripts/bump-version.sh 0.2.0
```

The bump script handles everything: version updates, commit, tag, and pushing to `development`, `main`, and the tag. The workflow runs automatically. Check **Actions** tab for progress.

### After Workflow Completes

1. Go to GitHub → **Releases**
2. Find the draft release
3. Edit release notes if needed
4. Click **Publish release**

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `APPLE_CERTIFICATE` | Base64-encoded .p12 certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for .p12 |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | 10-character Team ID |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/note67.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the key (no special characters) |

## Troubleshooting

### Update not detected

- Verify `latest.json` is accessible at the endpoint URL
- Check that version in `latest.json` is higher than installed version
- Ensure signature matches the build

### Signature verification failed

- Regenerate the signature with the same private key
- Verify public key in `tauri.conf.json` matches private key

### macOS Gatekeeper warning

Without Apple notarization, users will see security warnings. They can bypass by:
1. Right-click the app → Open → Open anyway
2. Or: System Settings → Privacy & Security → Open Anyway
