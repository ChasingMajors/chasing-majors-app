const {test}=require('node:test'),assert=require('node:assert/strict');
const {extractPrimaryPlayerName_,buildPlayers}=require('../scripts/build-player-meta.cjs');

test('extractPrimaryPlayerName_ strips a leading autograph tag-token prefix',()=>{
 assert.equal(extractPrimaryPlayerName_('-AP A.J. Puk'),'A.J. Puk');
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
