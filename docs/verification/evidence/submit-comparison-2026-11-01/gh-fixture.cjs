#!/Users/danielbaars/.local/share/mise/installs/node/24/bin/node
const fs = require('fs');
const args=process.argv.slice(2); fs.appendFileSync(process.env.PROBE_SENTINEL_LOG,JSON.stringify({tool:'gh',args})+'\n');
if(args[0]==='pr' && args[1]==='view'){console.error('no pull requests found for branch');process.exit(1)}
if(args[0]==='auth' && args[1]==='status'){process.exit(0)}
console.error('Blocked unimplemented GitHub helper');process.exit(97)
