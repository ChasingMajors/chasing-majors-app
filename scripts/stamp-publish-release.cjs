// Monitoring metadata only. Never changes product rows, identity or build decisions.
const fs = require('node:fs');
const path = require('node:path');
const manifests = ['data/v1/checklists/index.json','data/v1/vault/index.json','data/v2/vault/index.json'];
function stampRelease(root, sourceSha) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha || '')) throw new Error('Expected the exact source commit SHA.');
  // Parse every manifest before changing any file.
  const files = manifests.map(name => {
    const file = path.join(root,name), data = JSON.parse(fs.readFileSync(file,'utf8'));
    if (!Array.isArray(data.index)) throw new Error('Release manifest has no index: '+name);
    return {file,data};
  });
  for (const {file,data} of files) fs.writeFileSync(file,JSON.stringify({...data,release_sha:sourceSha})+'\n');
  return files.length;
}
module.exports = {stampRelease};
if (require.main === module) console.log('Release SHA stamped on '+stampRelease(path.resolve(__dirname,'..'),process.argv[2])+' manifests.');
