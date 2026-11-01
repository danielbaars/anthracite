#!/bin/sh
set -eu
cd /private/tmp/anthracite-sync-updates-implementation-20261101/worktrees/87/apps/cli
export PATH=/Users/danielbaars/.nvm/versions/node/v24.19.0/bin:$PATH
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
exec node ../../node_modules/mocha/bin/mocha.js \
 dist/test/commands/frozen_sync_cli.test.js \
 dist/test/commands/get_graph_cli.test.js \
 dist/test/commands/get_trunk_parent_cli.test.js \
 dist/test/commands/get_recovery_cli.test.js \
 dist/test/commands/get_publication_cli.test.js \
 dist/test/commands/create_insert_child_recovery_cli.test.js \
 dist/test/commands/land_recovery_cli.test.js \
 dist/test/commands/continue/continue.test.js \
 dist/test/commands/repo/sync_continue.test.js \
 dist/test/commands/repo/sync.test.js \
 dist/test/commands/modern_legacy_routes_cli.test.js \
 dist/test/commands/get_reconciliation_cli.test.js \
 --grep 'checks every mandatory cleanup survivor after the real pre-rebase|does not add an ancestor sibling|refuses divergent local trunk with force=true|resumes fanout from pinned sources|topology changed by a source cleanup hook|gives manual guidance when a hook changes the saved envelope|retains independently changed unselected metadata|resumes a preserved no-active queue locally|Lands on the restacked branch|Can continue a repo sync with multiple merge conflicts|Can noop sync if there are no stacks|Can defer replay explicitly|^(modern|public).*(get|g) fast-forwards from a real local remote|unique local commits|old parent commits|keeps saved no-restack authority' "$@"
