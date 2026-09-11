#!/usr/bin/env bash
# Same GitHub Release -> S3/CloudFront channel as the existing HiQ CLI releases.
set -euo pipefail
TAG="${1:?用法: mirror-to-cdn.sh v<version>}"
BUCKET="${DOWNLOAD_S3_BUCKET:?需要配置 DOWNLOAD_S3_BUCKET}"
DIST="${DOWNLOAD_CF_DIST_ID:?需要配置 DOWNLOAD_CF_DIST_ID}"
REPO=HiQ-AI/cortex-org-wiki-cli
TOOL=cortex-org-wiki
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo '无效版本 tag'; exit 1; }
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
gh release download "$TAG" --repo "$REPO" --dir "$tmp" --pattern 'cortex-org-wiki-*' --pattern 'agent-setup.md' --pattern 'checksums.txt'
(cd "$tmp" && shasum -a 256 -c checksums.txt)
test -s "$tmp/agent-setup.md"
for file in "$tmp"/*; do
  name=$(basename "$file")
  aws s3 cp "$file" "s3://$BUCKET/cli/$TOOL/releases/$TAG/$name" --cache-control 'public,max-age=31536000,immutable' --only-show-errors
  aws s3 cp "$file" "s3://$BUCKET/cli/$TOOL/latest/$name" --cache-control 'public,max-age=300' --only-show-errors
done
# Existing Desktop cliProvisioner expects raw binaries at /cli/<name>/v<version>/.
for platform in darwin-arm64 darwin-x64 linux-x64 linux-arm64 windows-x64; do
  name="$TOOL-$platform"; [[ "$platform" == windows-* ]] && name="$name.exe"
  aws s3 cp "$tmp/$name" "s3://$BUCKET/cli/$TOOL/$TAG/$name" --cache-control 'public,max-age=31536000,immutable' --only-show-errors
done
for file in install.sh install.ps1; do
  aws s3 cp "scripts/$file" "s3://$BUCKET/cli/$TOOL/$file" --content-type 'text/plain; charset=utf-8' --cache-control 'public,max-age=300' --only-show-errors
done
aws s3 cp "$tmp/agent-setup.md" "s3://$BUCKET/cli/$TOOL/agent-setup.md" --content-type 'text/markdown; charset=utf-8' --cache-control 'public,max-age=300' --only-show-errors
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/cli/$TOOL/*" --query 'Invalidation.Id' --output text
