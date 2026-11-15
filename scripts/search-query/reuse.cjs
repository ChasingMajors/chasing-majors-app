'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const {fingerprint, plan, readDirectory} = require('./artifact.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function filesUnder(directory, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw Error('Cache input/output symlink');
    if (entry.isDirectory()) files.push(...filesUnder(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else throw Error('Unexpected cache file type');
  }
  return files.sort();
}

function checkSourceReferences(root) {
  const directory = path.join(root, 'data/v1/checklists/search-index');
  function checked(relative) {
    if (typeof relative !== 'string' || !/^[A-Za-z0-9_./-]+\.json$/.test(relative) ||
        relative.startsWith('/') || relative.split('/').includes('..')) {
      throw Error('Search reference outside fingerprinted JSON inputs');
    }
    const file = path.join(directory, relative);
    if (!fs.statSync(file).isFile()) throw Error('Missing search reference');
    return file;
  }
  function leaf(relative) {
    const manifest = JSON.parse(fs.readFileSync(checked(relative), 'utf8'));
    if (manifest.sharded) for (const shard of manifest.shards) {
      if (typeof shard !== 'string' || shard.startsWith('/') || shard.split('/').includes('..')) throw Error('Unsafe search shard');
      checked(path.posix.join(path.posix.dirname(relative), shard));
    }
  }
  const registry = JSON.parse(fs.readFileSync(checked('sources.json'), 'utf8'));
  for (const sport of ['baseball', 'basketball', 'football', 'hockey', 'soccer']) {
    leaf(sport + '.json');
    for (const entry of registry.sources[sport] || []) leaf(entry.path || ('sources/' + entry.file));
  }
}

function inputs(root) {
  checkSourceReferences(root);
  const sources = filesUnder(path.join(root, 'data/v1/checklists/search-index'))
    .filter(file => file.endsWith('.json'))
    .map(file => 'data/v1/checklists/search-index/' + file);
  const builders = filesUnder(path.join(root, 'scripts/search-query')).map(file => 'scripts/search-query/' + file);
  const consumers = ['ChatBot/config.js', 'ChatBot/utils.js', 'ChatBot/cache.js', 'ChatBot/api.js',
    'checklists/app.js', '.github/recovery/canonical-runtime.cjs'];
  const files = [...sources, ...builders, ...consumers].sort().map(file => {
    let bytes = fs.readFileSync(path.join(root, file));
    const sourceJson = sources.includes(file);
    if (sourceJson) {
      const value = JSON.parse(bytes);
      // Only this top-level delivery timestamp is unused by the offline builder.
      // Nested row fields, all other metadata, references and array order stay covered.
      if (value && typeof value === 'object' && !Array.isArray(value)) delete value.generated_at;
      bytes = Buffer.from(JSON.stringify(value));
    }
    return {path: file, hash_kind: sourceJson ? 'json-without-top-level-generated_at' : 'bytes', sha256: hash(bytes)};
  });
  // Include V8/SQLite/ICU/zlib versions as well as Node. Locale affects legacy sorting.
  const runtime = {versions: process.versions, platform: process.platform, arch: process.arch,
    locale: Intl.DateTimeFormat().resolvedOptions(), node_options: process.env.NODE_OPTIONS || ''};
  const description = {schema_version: 2, runtime, files};
  return {...description, fingerprint: hash(JSON.stringify(description)), canonical_sha256: fingerprint(root)};
}

function inventory(directory) {
  return filesUnder(directory).map(file => {
    const bytes = fs.readFileSync(path.join(directory, file));
    return {path: file, bytes: bytes.length, sha256: hash(bytes)};
  });
}

function validate(root, cache, input) {
  const receipt = JSON.parse(fs.readFileSync(path.join(cache, 'receipt.json'), 'utf8'));
  if (receipt.schema_version !== 2 || receipt.fingerprint !== input.fingerprint) throw Error('Fingerprint mismatch');
  const directory = path.join(cache, 'derived');
  const actual = inventory(directory);
  if (JSON.stringify(actual) !== JSON.stringify(receipt.files) || hash(JSON.stringify(actual)) !== receipt.content_sha256) {
    throw Error('Cached directory integrity mismatch');
  }
  // Verify the original cache binding and every compressed/decoded shard before copying.
  // Exact semantic input equality permits rebinding only delivery timestamps/formatting.
  if (!/^[a-f0-9]{64}$/.test(receipt.canonical_sha256 || '')) throw Error('Invalid canonical cache binding');
  readDirectory(directory, receipt.canonical_sha256);
  return directory;
}

function checkLocations(root, work, cache) {
  for (const directory of [work, cache]) {
    if (directory === root || directory.startsWith(root + path.sep)) throw Error('Workspace/cache must be outside checkout');
  }
  if (work === cache || work.startsWith(cache + path.sep) || cache.startsWith(work + path.sep)) {
    throw Error('Workspace and cache must be separate');
  }
}

function run(root, work, cache) {
  checkLocations(root, work, cache);
  const started = performance.now();
  const input = inputs(root);
  if (fs.existsSync(work)) throw Error('Search workspace must be fresh');
  let source;
  let reason;
  try { source = validate(root, cache, input); }
  catch (error) { reason = error.code || error.message; }
  fs.mkdirSync(work, {recursive: true});
  if (source) {
    const directory = path.join(work, 'derived');
    fs.cpSync(source, directory, {recursive: true});
    const file = path.join(directory, 'index.json');
    const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
    metadata.canonical_sha256 = input.canonical_sha256;
    fs.writeFileSync(file, JSON.stringify(metadata) + '\n');
  }
  else {
    for (const script of ['build.cjs', 'grams.cjs']) {
      cp.execFileSync(process.execPath, [path.join(root, 'scripts/search-query', script)], {
        cwd: root, stdio: 'inherit', env: {...process.env, CM_QUERY_ROOT: root, CM_QUERY_WORK: work}
      });
    }
  }
  const current = inputs(root);
  if (current.fingerprint !== input.fingerprint || current.canonical_sha256 !== input.canonical_sha256) {
    throw Error('Search inputs changed during build/reuse');
  }
  const directory = path.join(work, 'derived');
  plan(root, directory, 'cache-validation');
  const files = inventory(directory);
  const receipt = {schema_version: 2, fingerprint: input.fingerprint,
    canonical_sha256: input.canonical_sha256, content_sha256: hash(JSON.stringify(files)), files};
  fs.writeFileSync(path.join(work, 'receipt.json'), JSON.stringify(receipt) + '\n');
  const result = {state: 'STAGED', mode: source ? 'reuse' : 'rebuild', reason: reason || 'exact fingerprint and verified bytes',
    fingerprint: input.fingerprint, content_sha256: receipt.content_sha256,
    files: files.length, bytes: files.reduce((total, file) => total + file.bytes, 0), elapsed_ms: performance.now() - started};
  fs.writeFileSync(path.join(work, 'reuse-result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  return result;
}

function save(root, work, cache) {
  checkLocations(root, work, cache);
  validate(root, work, inputs(root));
  fs.rmSync(cache, {recursive: true, force: true});
  fs.mkdirSync(cache, {recursive: true});
  fs.cpSync(path.join(work, 'derived'), path.join(cache, 'derived'), {recursive: true});
  fs.copyFileSync(path.join(work, 'receipt.json'), path.join(cache, 'receipt.json'));
}
module.exports = {inputs, inventory, validate, run, save};
if (require.main === module) {
  const [mode, ...args] = process.argv.slice(2);
  const root = path.resolve(process.env.CM_QUERY_ROOT || path.join(__dirname, '../..'));
  if (mode === 'key') {
    const input = inputs(root);
    fs.writeFileSync(args[0], JSON.stringify(input, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'key=bounded-search-v2-' + input.fingerprint + '\n');
    console.log(input.fingerprint);
  } else if (mode === 'run') run(root, path.resolve(args[0]), path.resolve(args[1]));
  else if (mode === 'save') save(root, path.resolve(args[0]), path.resolve(args[1]));
  else throw Error('Usage: reuse.cjs key INPUT_REPORT | run WORK CACHE | save WORK CACHE');
}
