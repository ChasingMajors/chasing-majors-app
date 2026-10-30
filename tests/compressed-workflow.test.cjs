const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('compressed publish retains blocking validation and exact immutable artifact dependencies',()=>{
 const s=fs.readFileSync('.github/workflows/vault-data.yml','utf8');
 for(const v of ['Validate source','Deterministically rebuild','Content regression tests (blocking)','Validate rebuilt release','Assemble one immutable','needs: refresh','needs: [refresh, deploy]','actions/deploy-pages@','node-version: \'24\'','CM_QUERY_DIRECTORY','content-release-manifest'])assert(s.includes(v),v);
 assert(!/continue-on-error|git reset|git push|git commit|pages\/builds/.test(s));assert(s.includes('test "$latest" = "$GITHUB_SHA"'));assert(s.includes("if: github.ref == 'refs/heads/main'"));
 assert(s.indexOf('Content regression tests (blocking)')<s.indexOf('Upload exact validated artifact'));
});
test('optional export failures have their own workflow and never enter deploy needs',()=>{const s=fs.readFileSync('.github/workflows/optional-release-exports.yml','utf8'),critical=fs.readFileSync('.github/workflows/vault-data.yml','utf8');assert(s.includes('simulate_failure'));assert(s.includes('exit 1'));assert(!critical.includes('optional-release-exports'));assert(!/wrangler|api\.cloudflare|SpreadsheetApp/.test(s));});
test('canonical rebuild pins timestamps and source SHA without relying on another push',()=>{const s=fs.readFileSync('scripts/build-content-release.cjs','utf8'),v=fs.readFileSync('scripts/build-vault-data.cjs','utf8');assert(s.includes('CM_RELEASE_BUILD_TIME'));assert(s.includes('process.env.GITHUB_SHA'));assert(v.includes('process.env.CM_RELEASE_BUILD_TIME'));});
