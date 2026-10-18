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

// Helper: build one solo-RC player from a single product and return the record.
const only=(products,name)=>{
 const r=buildPlayers(products).filter(p=>p.player_name===name);
 assert.equal(r.length,1,`expected exactly one record for ${name}`);
 return r[0];
};

test('true base-RC tags yield an rc_year candidate (whole `rc` token)',()=>{
 // Plain "RC" (the dominant 53k-row true-RC tag): first appearance == RC year
 // so the conservative rule keeps it at high confidence.
 const bare=only([{meta:{sport:'Baseball',year:'2020'},rows:[{player:'Solo Rookie',tag:'RC'}]}],'Solo Rookie');
 assert.equal(bare.rc_year,2020);
 assert.equal(bare.rc_year_confidence,'high');
 // Serial-numbered RC "RC /99" -> normalized "rc 99": token present.
 const serial=only([{meta:{sport:'Baseball',year:'2020'},rows:[{player:'Serial Rookie',tag:'RC /99'}]}],'Serial Rookie');
 assert.equal(serial.rc_year,2020);
 assert.equal(serial.rc_year_confidence,'high');
 // "Rookie Short Print RC" ends in the RC token -> legitimate base RC.
 const sp=only([{meta:{sport:'Baseball',year:'2020'},rows:[{player:'Shortprint Rookie',tag:'Rookie Short Print RC'}]}],'Shortprint Rookie');
 assert.equal(sp.rc_year,2020);
 assert.equal(sp.rc_year_confidence,'high');
 // "DP, RC" -> "dp rc": token present.
 const dp=only([{meta:{sport:'Baseball',year:'2020'},rows:[{player:'Draftpick Rookie',tag:'DP, RC'}]}],'Draftpick Rookie');
 assert.equal(dp.rc_year,2020);
});

test('tags that merely contain `rc`/`rookie` but are inserts/promos do NOT yield a candidate',()=>{
 // PRC is the key regression guard for the old substring bug:
 // normalize_('PRC')='prc' contains substring 'rc' but has no 'rc' token.
 for(const tag of ['PRC','PRC /40','Rookie','RY','Rookie Patch Autographs','Rookie Dual Patch Autographs','Rookie Stars','Rookie of the Year Award']){
  const rec=only([{meta:{sport:'Baseball',year:'2015'},rows:[{player:'Insert Only',tag}]}],'Insert Only');
  assert.equal(rec.rc_year,null,`tag ${JSON.stringify(tag)} must not yield rc_year`);
  assert.equal(rec.rc_year_confidence,'none',`tag ${JSON.stringify(tag)} must be none`);
 }
});

test('a genuine base-RC token at the true rookie year is KEPT even when the player appears earlier as a prospect',()=>{
 // Prospect-shaped (Gunnar Henderson / Julio Rodríguez): the player appears in
 // Bowman/prospect checklists for several years with no RC tag, then gets a
 // genuine base `RC` at his true rookie year. The earliest base-RC token is the
 // correct rookie year and MUST be retained at high confidence — we do NOT
 // demote it for the earlier prospect appearances. A "first-appearance gap"
 // heuristic would erase ~1000 correctly base-RC-tagged rookie years, so it is
 // intentionally absent.
 const prospect=only([
  {meta:{sport:'Baseball',year:'2019'},rows:[{player:'Prospect Rookie',tag:''}]},
  {meta:{sport:'Baseball',year:'2020'},rows:[{player:'Prospect Rookie',tag:''}]},
  {meta:{sport:'Baseball',year:'2023'},rows:[{player:'Prospect Rookie',tag:'RC'}]}
 ],'Prospect Rookie');
 assert.equal(prospect.rc_year,2023);
 assert.equal(prospect.rc_year_confidence,'high');
});

test('earliest base-RC token wins when several RC-tagged years exist',()=>{
 const multi=only([
  {meta:{sport:'Baseball',year:'2026'},rows:[{player:'Multi Rookie',tag:'RC'}]},
  {meta:{sport:'Baseball',year:'2021'},rows:[{player:'Multi Rookie',tag:'RC /99'}]}
 ],'Multi Rookie');
 assert.equal(multi.rc_year,2021);
 assert.equal(multi.rc_year_confidence,'high');
});

test('clean single-year RC (RC == first appearance) is high confidence',()=>{
 const clean=only([{meta:{sport:'Baseball',year:'2019'},rows:[{player:'Clean Rookie',tag:'RC'}]}],'Clean Rookie');
 assert.equal(clean.rc_year,2019);
 assert.equal(clean.rc_year_confidence,'high');
});

test('multi-player combo with an RC tag contributes no rc candidate to either name',()=>{
 const players=buildPlayers([{meta:{sport:'Baseball',year:'2018'},rows:[{player:'Mike Trout / Aaron Judge',tag:'RC'}]}]);
 const trout=players.filter(p=>p.player_name==='Mike Trout');
 const judge=players.filter(p=>p.player_name==='Aaron Judge');
 // extractPrimaryPlayerName_ yields the first solo name, but isSafeSoloRcRow_
 // rejects the combo, so no RC candidate is recorded.
 if(trout.length){assert.equal(trout[0].rc_year,null);}
 assert.equal(judge.length,0);
});
