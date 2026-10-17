#!/bin/sh
# oneskill launcher — double-click to open the manager.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! node -e "require.resolve('zod'); require.resolve('@modelcontextprotocol/sdk/server/index.js'); require.resolve('@modelcontextprotocol/ext-apps/server')" >/dev/null 2>&1; then
  npm ci || exit 1
fi
exec npm start
