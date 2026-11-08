#!/bin/sh
# One repo, two Vercel projects.
# The chronicledeluxe2.0 project (www.chronicledeluxe.com) serves the static
# Chronicle Deluxe site in chronicle-deluxe/ exactly as it is, no build.
# Every other project (playground, kildestudios.com) builds the Vite app as
# before. VERCEL_PROJECT_PRODUCTION_URL is a Vercel system variable.
set -e
case "$VERCEL_PROJECT_PRODUCTION_URL" in
  *chronicledeluxe*)
    echo "Chronicle Deluxe project: serving chronicle-deluxe/ as static files"
    rm -rf dist
    cp -R chronicle-deluxe dist
    rm -f dist/README.md
    ;;
  *)
    npm run build
    ;;
esac
