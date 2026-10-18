const {test}=require('node:test'),assert=require('node:assert/strict');
const {nameKey,serialKind}=require('../scripts/audit-card-identities.cjs');
test('alias candidates preserve player suffixes and product seasons',()=>{
 assert.equal(nameKey('José Altuve'),nameKey('Jose Altuve'));
 assert.notEqual(nameKey('大谷翔平'),nameKey('山本由伸'));
 assert.notEqual(nameKey('Vladimir Guerrero Jr.'),nameKey('Vladimir Guerrero Sr.'));
 assert.notEqual(nameKey('2025 Topps Chrome'),nameKey('2026 Topps Chrome'));
});
test('serial audit distinguishes qualifiers and corrupted dates from exact limits',()=>{
 assert.equal(serialKind('1/1'),'exact');assert.equal(serialKind('/99*'),'footnoted');
 assert.equal(serialKind('- /99'),'decorated_exact');assert.equal(serialKind('/199 or less'),'maximum');
 assert.equal(serialKind('PR: 50'),'print_run_in_serial_field');
 assert.equal(serialKind('Thu Jan 01 2026 00:00:00 GMT-0700 (Mountain Standard Time)'),'date_corruption');
});
