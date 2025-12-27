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

# Update tauri.conf.json
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$ROOT_DIR/src-tauri/tauri.conf.json"
echo "  Updated src-tauri/tauri.conf.json"

echo ""
echo "Version updated to $VERSION"
echo ""
echo "Next steps:"
echo "  1. git add -A"
echo "  2. git commit -m \"chore: bump version to $VERSION\""
echo "  3. git tag v$VERSION"
echo "  4. git push origin main --tags"
