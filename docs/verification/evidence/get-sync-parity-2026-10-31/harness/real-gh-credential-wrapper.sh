#!/bin/sh
# Use the real gh and its existing macOS credential store; keep the tested CLI home isolated.
HOME=/Users/danielbaars GH_CONFIG_DIR=/Users/danielbaars/.config/gh exec /opt/homebrew/bin/gh "$@"
