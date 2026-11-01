#!/bin/sh
set -eu
cd /private/tmp/anthracite-sync-updates-implementation-20261101/worktrees/87/apps/cli
export PATH=/Users/danielbaars/.nvm/versions/node/v24.19.0/bin:$PATH
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
exec node ../../node_modules/mocha/bin/mocha.js \
 dist/test/commands/sync_refresh_cli.test.js \
 dist/test/commands/sync_authority_cli.test.js \
 dist/test/commands/sync_delete_all_cli.test.js \
 dist/test/commands/sync_cleanup_descendants_cli.test.js \
 dist/test/commands/sync_survivor_cli.test.js \
 dist/test/commands/sync_maintenance_cli.test.js \
 dist/test/commands/sync_completion_cli.test.js \
 dist/test/commands/sync_recovery_cli.test.js \
 dist/test/commands/sync_late_guards_cli.test.js \
 dist/test/commands/sync_delivery_cli.test.js \
 "$@"
