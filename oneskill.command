#!/bin/bash
# oneskill launcher — double-click to open the manager.
cd "$(dirname "$0")" || exit 1
exec /usr/bin/python3 oneskill.py serve --open
