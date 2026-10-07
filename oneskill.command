#!/bin/sh
# oneskill launcher — double-click to open the manager.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ ! -d node_modules/jsonc-parser ] || [ ! -d node_modules/smol-toml ]; then
  npm ci || exit 1
fi
exec npm start
