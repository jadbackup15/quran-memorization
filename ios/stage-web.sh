#!/bin/sh
# Copies the web app into the built .app as `web/`, which LocalWebServer then
# serves. rsync so the 123 MB of mushaf pages is only copied when it changes —
# a full copy on every build makes the edit/run loop unusable.
set -e

REPO="$SRCROOT/.."
DEST="$BUILT_PRODUCTS_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/web"
mkdir -p "$DEST"

# Individual files. Listed explicitly rather than globbed: this is what ends up
# inside the app, and a stray file in the repo root should not silently ship.
for f in review.html hizb.html sw.js manifest.json \
         version.js log.js quran-data.js quran-cache.js \
         mistake-analytics.js quran-line-bands.js native-bridge.js native-app.css; do
  rsync -a "$REPO/$f" "$DEST/$f"
done

# Directories.
rsync -a --delete "$REPO/icons/" "$DEST/icons/"
rsync -a --delete --include='*.md' --include='*/' --exclude='*' \
      "$REPO/agent-prompts/" "$DEST/agent-prompts/"

# The mushaf pages: 604 JPEGs, ~123 MB. The single biggest reason to build a
# native app at all — sw.js deliberately does NOT precache these, so the PWA
# cannot show the mushaf offline and this can. They are NEVER fetched at
# runtime: the app must render the mushaf with the device in airplane mode.
#
# SKIP_MUSHAF_PAGES only speeds up a Debug SIMULATOR loop. It is ignored for a
# device or Release build on purpose — shipping an app whose entire reason for
# existing is missing, because an env var was left set in a shell, is not a
# mistake worth leaving available.
SKIP="${SKIP_MUSHAF_PAGES:-0}"
case "$PLATFORM_NAME:$CONFIGURATION" in
  iphonesimulator:Debug) ;;
  *) SKIP=0 ;;
esac

if [ "$SKIP" = "1" ]; then
  echo "note: SKIP_MUSHAF_PAGES=1 (Debug simulator only), mushaf images not staged"
  rm -rf "$DEST/assets/pages"
else
  rsync -a --delete "$REPO/assets/pages/" "$DEST/assets/pages/"
  COUNT=$(ls "$DEST/assets/pages" | grep -c '\.jpg$' || true)
  if [ "$COUNT" -ne 604 ]; then
    echo "error: staged $COUNT mushaf pages, expected 604 — the app would be" \
         "missing pages with no network to fall back on." >&2
    exit 1
  fi
  echo "staged $COUNT mushaf pages"
fi

echo "staged web payload -> $DEST"
