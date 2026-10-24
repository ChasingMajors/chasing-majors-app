const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const read = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
function writeChanged(root, file, value) {
  const body = JSON.stringify(value, null, 2) + '\n';
  const target = path.join(root, file);
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === body) return false;
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, body);
  return true;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function fingerprint(product) {
  // Publisher revision stamps change on every export, even for unchanged products.
  const {source_revision, generated_at, ...content} = product;
  return crypto.createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex');
}
const identity = item => [item.vault, item.sport.toLowerCase(), item.code].join('|');
function updateRecentProducts(root, vault, products, stamp = new Date().toISOString()) {
  if (!['CV', 'PRV'].includes(vault)) throw Error('Unknown recent-products vault');
  const stateFile = 'data/recent-state.json', feedFile = 'data/recent.json';
  const state = fs.existsSync(path.join(root, stateFile)) ? read(root, stateFile) : {schema_version: 1, snapshots: {}};
  if (state.schema_version !== 1) throw Error('Unsupported recent-products state schema');
  const previous = state.snapshots[vault], next = {}, updates = [];
  for (const product of products) {
    const meta = product.meta || {};
    if (!product.rows?.length || !meta.code || !meta.displayName || !meta.sport) continue;
    const item = {displayName: meta.displayName, code: meta.code, sport: meta.sport.toLowerCase(), vault};
    const key = identity(item), hash = fingerprint(product);
    if (next[key]) throw Error('Duplicate recent-products identity: ' + key);
    next[key] = hash;
    // A first snapshot is a baseline, never evidence of a historical update date.
    if (previous && previous[key] !== hash) updates.push({...item, updated_at: new Date(stamp).toISOString()});
  }
  const feed = fs.existsSync(path.join(root, feedFile)) ? read(root, feedFile) : {items: []};
  const changedKeys = new Set(updates.map(identity));
  const items = [...updates, ...feed.items.filter(item => !changedKeys.has(identity(item)) && (item.vault !== vault || next[identity(item)]))]
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 10);
  state.snapshots[vault] = next;
  return [[stateFile, state], [feedFile, {items}]].filter(([file, value]) => writeChanged(root, file, value)).map(([file]) => file);
}
function checklistProducts(root) {
  const cache = new Map(), load = file => {if (!cache.has(file)) cache.set(file, read(root, file)); return cache.get(file);};
  return load('data/v1/checklists/index.json').index.flatMap(entry => {
    if (!entry.sport || !entry.Code) return [];
    const sport = entry.sport.toLowerCase(), base = 'data/v1/checklists/products/';
    const bundle = load(base + sport + '.json'), shard = bundle.product_map?.[entry.Code];
    const product = bundle.products?.[entry.Code] || (shard && load(base + shard).products?.[entry.Code]);
    if (!product) throw Error('Missing checklist product for recent feed: ' + entry.Code);
    return [product];
  });
}
function vaultProducts(root) {
  return read(root, 'data/v2/vault/index.json').index.map(entry => read(root, 'data/v2/vault/products/' + entry.file));
}
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  console.log(JSON.stringify([
    ...updateRecentProducts(root, 'CV', checklistProducts(root)),
    ...updateRecentProducts(root, 'PRV', vaultProducts(root))
  ]));
}
module.exports = {updateRecentProducts, checklistProducts, vaultProducts};
