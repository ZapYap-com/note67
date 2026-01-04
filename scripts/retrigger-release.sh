#!/bin/bash
# Usage: ./scripts/retrigger-release.sh 0.1.13
#
# Deletes and recreates a git tag to retrigger GitHub Actions release workflow.
# Note: This does NOT delete previous workflow runs - GitHub keeps all run history.

set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 0.1.13"
  exit 1
fi

TAG="v$VERSION"

echo "Retriggering release for $TAG..."

# Delete remote tag
echo "Deleting remote tag $TAG..."
git push origin --delete "$TAG" 2>/dev/null || echo "  Remote tag not found (skipping)"

# Delete local tag
echo "Deleting local tag $TAG..."
git tag -d "$TAG" 2>/dev/null || echo "  Local tag not found (skipping)"

# Create new tag
echo "Creating tag $TAG..."
git tag "$TAG"

# Push tag
echo "Pushing tag $TAG..."
git push origin "$TAG"

echo ""
echo "============================================"
echo "Done! Tag $TAG pushed."
echo "Check GitHub Actions for the new workflow run."
echo "============================================"
