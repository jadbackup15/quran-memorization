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
# cannot show the mushaf offline and this can.
if [ "${SKIP_MUSHAF_PAGES:-0}" = "1" ]; then
  echo "note: SKIP_MUSHAF_PAGES=1, mushaf images not staged"
else
  rsync -a --delete "$REPO/assets/pages/" "$DEST/assets/pages/"
fi

echo "staged web payload -> $DEST"
