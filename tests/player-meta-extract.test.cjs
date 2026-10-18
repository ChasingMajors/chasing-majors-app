const {test}=require('node:test'),assert=require('node:assert/strict');
const {extractPrimaryPlayerName_,buildPlayers}=require('../scripts/build-player-meta.cjs');

test('extractPrimaryPlayerName_ strips a leading autograph tag-token prefix',()=>{
 assert.equal(extractPrimaryPlayerName_('-AP A.J. Puk'),'A.J. Puk');
});

test('extractPrimaryPlayerName_ drops a leading-Unicode-dash garbage label',()=>{
 // "– Black" (en-dash U+2013) is a parallel/color word, not a player:
 // the leading dash must be stripped, leaving a single token that is rejected.
 assert.equal(extractPrimaryPlayerName_('\u2013 Black'),'');
 // A genuine dash-prefixed multi-word name keeps its name with no leading dash.
 assert.equal(extractPrimaryPlayerName_('\u2013 Mike Trout'),'Mike Trout');
 // Unicode-dash autograph tag is stripped like the ASCII one.
 assert.equal(extractPrimaryPlayerName_('\u2013AP A.J. Puk'),'A.J. Puk');
});

test('buildPlayers yields one record per sport for a multi-sport player',()=>{
 const products=[
  {meta:{sport:'Baseball',year:'2024'},rows:[{player:'Mike Trout',tag:''}]},
  {meta:{sport:'Football',year:'2024'},rows:[{player:'Mike Trout',tag:''}]}
 ];
 const players=buildPlayers(products).filter(p=>p.player_name==='Mike Trout');
 assert.equal(players.length,2);
 const sports=players.map(p=>p.sport).sort();
 assert.deepEqual(sports,['baseball','football']);
});
