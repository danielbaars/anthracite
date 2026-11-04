// Controlled external gh process for release-retention acceptance.
module.exports = `#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);const state=JSON.parse(fs.readFileSync(process.env.RELEASE_SERVICE_STATE));
state.calls.push(args);
let response;
if(args[0]==='api') {
 const route=args.find(value=>value.startsWith('repos/'));
 if(route==='repos/danielbaars/anthracite') response={full_name:'danielbaars/anthracite',default_branch:'main'};
 else if(route.endsWith('/git/ref/heads/main')) response={object:{sha:state.source}};
 else if(route.includes('matching-refs')) response=state.release ? [{ref:'refs/tags/'+(state.tag||'v0.7.0-beta.1'),object:{type:'commit',sha:state.tagSource||state.source||'a'.repeat(40)}}] : [];
 else if(route.endsWith('/assets?per_page=100')) {let assets=Object.entries(state.assets).map(([name,bytes],index)=>({name,id:index+1}));if(state.uploads && state.assetLag>0){state.assetLag--;assets=assets.slice(0,-1);}response=[assets];}
 else if(route.includes('/releases/assets/')) {const id=Number(route.split('/').pop());response=Buffer.from(Object.values(state.assets)[id-1],'base64');}
 else if(route.includes('/releases?per_page=100')) {
  if(state.inventoryForbidden){fs.writeFileSync(process.env.RELEASE_SERVICE_STATE,JSON.stringify(state));process.stdout.write(JSON.stringify({message:'Forbidden'}));process.stderr.write('gh: Forbidden (HTTP 403)');process.exit(1);}
  response=[state.release && !state.staleList ? [{id:1,tag_name:state.tag||'v0.7.0-beta.1',prerelease:!state.changed,draft:false}] : []];
 }
 else if(route.includes('/releases/tags/')) {
  if(state.forbidden){fs.writeFileSync(process.env.RELEASE_SERVICE_STATE,JSON.stringify(state));process.stdout.write(JSON.stringify({message:'Resource not accessible by integration'}));process.stderr.write('gh: Resource not accessible by integration (HTTP 403)');process.exit(1);}
  const delayed=state.created && state.directLag>0;if(delayed)state.directLag--;
  if(state.release && !delayed) response={id:1,tag_name:state.tag||'v0.7.0-beta.1',prerelease:state.changed?false:(state.prerelease??true),draft:false};
  else {fs.writeFileSync(process.env.RELEASE_SERVICE_STATE,JSON.stringify(state));process.stdout.write(JSON.stringify({message:'Not Found'}));process.stderr.write('gh: Not Found (HTTP 404)');process.exit(1);}
 }
 else throw Error('Unexpected read '+route);
} else if(args[0]==='release' && args[1]==='create') {
 if(state.release)throw Error('Duplicate release creation');state.release=true;state.created=true;state.tag=args[2];state.tagSource=args[args.indexOf('--target')+1];state.prerelease=args.includes('--prerelease');state.creates=(state.creates||0)+1;
} else if(args[0]==='release' && args[1]==='upload') {
 const file=args[3];state.uploads++;state.assets[require('node:path').basename(file)]=fs.readFileSync(file).toString('base64');if(state.changeAfterUpload)state.changed=true;
} else throw Error('Forbidden mutation '+args.join(' '));
fs.writeFileSync(process.env.RELEASE_SERVICE_STATE,JSON.stringify(state));
if(Buffer.isBuffer(response))process.stdout.write(response);else if(response!==undefined)process.stdout.write(JSON.stringify(response));
`;
