#!/bin/bash

set -e
set -o pipefail

echo "🚀 Starting Claude installer..."

TARGET="$1"
echo "📌 Target: ${TARGET:-latest}"

DOWNLOAD_BASE_URL="https://downloads.claude.ai/claude-code-releases"
DOWNLOAD_DIR="$HOME/.claude/downloads"

echo "📂 Download dir: $DOWNLOAD_DIR"

# Check downloader
echo "🔍 Checking downloader..."
if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
else
    echo "❌ Neither curl nor wget found"
    exit 1
fi
echo "✅ Using downloader: $DOWNLOADER"

# Check jq
echo "🔍 Checking jq..."
if command -v jq >/dev/null 2>&1; then
    HAS_JQ=true
    echo "✅ jq found"
else
    HAS_JQ=false
    echo "⚠️ jq not found (fallback parser will be used)"
fi

download_file() {
    local url="$1"
    local output="$2"

    echo "⬇️ Downloading: $url" >&2   # 👈 THIS FIX

    if [ "$DOWNLOADER" = "curl" ]; then
        if [ -n "$output" ]; then
            curl -fSL -o "$output" "$url"
        else
            curl -fSL "$url"
        fi
    else
        if [ -n "$output" ]; then
            wget -O "$output" "$url"
        else
            wget -O - "$url"
        fi
    fi
}

echo "🖥 Detecting platform..."
case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *) echo "❌ Unsupported OS"; exit 1 ;;
esac

case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo "❌ Unsupported arch"; exit 1 ;;
esac

platform="${os}-${arch}"
echo "✅ Platform: $platform"

mkdir -p "$DOWNLOAD_DIR"

echo "🌐 Fetching latest version..."
version=$(download_file "$DOWNLOAD_BASE_URL/latest")
echo "✅ Version: $version"

echo "📦 Fetching manifest..."
manifest_json=$(download_file "$DOWNLOAD_BASE_URL/$version/manifest.json")

echo "🔐 Extracting checksum..."
if [ "$HAS_JQ" = true ]; then
    checksum=$(echo "$manifest_json" | jq -r ".platforms[\"$platform\"].checksum // empty")
else
    checksum=$(echo "$manifest_json" | tr -d '\n' | grep -o "\"$platform\"[^}]*" | grep -o '"checksum":"[^"]*"' | cut -d':' -f2 | tr -d '"')
fi

echo "🔑 Checksum: $checksum"

if [ -z "$checksum" ]; then
    echo "❌ Failed to extract checksum"
    exit 1
fi

binary_path="$DOWNLOAD_DIR/claude-$version-$platform"

echo "⬇️ Downloading binary..."
download_file "$DOWNLOAD_BASE_URL/$version/$platform/claude" "$binary_path"

echo "🔍 Verifying checksum..."
if [ "$os" = "darwin" ]; then
    actual=$(shasum -a 256 "$binary_path" | cut -d' ' -f1)
else
    actual=$(sha256sum "$binary_path" | cut -d' ' -f1)
fi

echo "🔑 Expected: $checksum"
echo "🔑 Actual:   $actual"

if [ "$actual" != "$checksum" ]; then
    echo "❌ Checksum mismatch"
    exit 1
fi

chmod +x "$binary_path"
echo "✅ Binary ready"

echo "⚙️ Running installer..."
"$binary_path" install ${TARGET:+"$TARGET"}

echo "🧹 Cleaning up..."
rm -f "$binary_path"

echo ""
echo "🎉 Installation complete!"
echo ""