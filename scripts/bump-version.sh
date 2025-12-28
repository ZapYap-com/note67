#!/bin/bash
# Usage: ./scripts/bump-version.sh 0.2.0
#
# This script updates the version in all configuration files:
# - package.json
# - src-tauri/Cargo.toml
# - src-tauri/tauri.conf.json

set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 0.2.0"
  exit 1
fi

# Validate version format (basic semver check)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Version must be in semver format (e.g., 1.2.3)"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Updating version to $VERSION..."

# Update package.json
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$ROOT_DIR/package.json"
echo "  Updated package.json"

# Update Cargo.toml (only the package version, not dependencies)
sed -i '' "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" "$ROOT_DIR/src-tauri/Cargo.toml"
echo "  Updated src-tauri/Cargo.toml"

# Update Cargo.lock by running cargo check
echo "  Updating Cargo.lock..."
# Source cargo environment if available
if [ -f "$HOME/.cargo/env" ]; then
  source "$HOME/.cargo/env"
fi
(cd "$ROOT_DIR/src-tauri" && cargo check --quiet)
echo "  Updated src-tauri/Cargo.lock"

# Update tauri.conf.json
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$ROOT_DIR/src-tauri/tauri.conf.json"
echo "  Updated src-tauri/tauri.conf.json"

# Update frontend constants
sed -i '' "s/APP_VERSION = \"[^\"]*\"/APP_VERSION = \"$VERSION\"/" "$ROOT_DIR/src/components/settings/constants.ts"
echo "  Updated src/components/settings/constants.ts"

echo ""
echo "Version updated to $VERSION"
echo ""

# Git operations
cd "$ROOT_DIR"

echo ""
echo "Committing changes..."
git add -A
git commit -m "chore: bump version to $VERSION"

echo ""
echo "Creating tag v$VERSION..."
git tag "v$VERSION"

echo ""
echo "Pushing to development..."
git push origin development && echo "  ✓ Pushed to development"

echo ""
echo "Pushing development to main..."
git push origin development:main && echo "  ✓ Pushed development to main"

echo ""
echo "Pushing tag v$VERSION..."
git push origin "v$VERSION" && echo "  ✓ Pushed tag v$VERSION"

echo ""
echo "============================================"
echo "Done! Version $VERSION has been released."
echo "============================================"
