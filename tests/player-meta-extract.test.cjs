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

test('a THICK base-RC signal at the true rookie year is KEPT even when the player appears earlier as a prospect',()=>{
 // Prospect-shaped (Gunnar Henderson 2023 = 61 RC rows / Julio Rodríguez 2022 =
 // 69): the player appears in Bowman/prospect checklists for several years with
 // no RC tag, then gets a genuine base `RC` across MANY products at his true
 // rookie year. The earliest base-RC token year is the correct rookie year and
 // MUST be retained at high confidence. The confidence rule only demotes a
 // candidate that is BOTH thin AND late; a late-but-thick signal (>2 RC rows)
 // stays high, so legitimate prospect RCs are NOT over-pruned.
 const prospect=only([
  {meta:{sport:'Baseball',year:'2019'},rows:[{player:'Prospect Rookie',tag:''}]},
  {meta:{sport:'Baseball',year:'2020'},rows:[{player:'Prospect Rookie',tag:''}]},
  {meta:{sport:'Baseball',year:'2023'},rows:[
   {player:'Prospect Rookie',tag:'RC'},
   {player:'Prospect Rookie',tag:'RC /99'},
   {player:'Prospect Rookie',tag:'RC | SP'}
  ]}
 ],'Prospect Rookie');
 assert.equal(prospect.rc_year,2023);
 assert.equal(prospect.rc_year_confidence,'high');
});

test('a THIN, LATE base-RC token (Judge-shaped stray insert) is DROPPED, not asserted as high',()=>{
 // Judge-shaped: first checklist appearance precedes the only base-RC token by
 // >=2 years, and that token year is thin (<=2 RC rows). This is a stray late
 // insert (a reprinted bare `RC` years after the player debuted), not the true
 // rookie year. Because the ChatBot consumer prints rc_year verbatim and
 // ignores confidence, the only not-wrong outcome is to DROP it: rc_year null,
 // confidence none. It must NOT be {rc_year:2018, confidence:'high'}.
 const judge=only([
  {meta:{sport:'Baseball',year:'2016'},rows:[{player:'Late Insert Vet',tag:''}]},
  {meta:{sport:'Baseball',year:'2017'},rows:[{player:'Late Insert Vet',tag:''}]},
  {meta:{sport:'Baseball',year:'2018'},rows:[
   {player:'Late Insert Vet',tag:'RC'},
   {player:'Late Insert Vet',tag:'RC'}
  ]}
 ],'Late Insert Vet');
 assert.notEqual(judge.rc_year_confidence,'high');
 assert.equal(judge.rc_year,null);
 assert.equal(judge.rc_year_confidence,'none');
 assert.ok(!(judge.rc_year===2018&&judge.rc_year_confidence==='high'),
  'Judge-shaped stray insert must not ship as 2018/high');
});

test('a THIN but EARLY base-RC token (true rookie year in a small set) stays high',()=>{
 // Not every thin RC signal is a late insert: a genuine rookie in a niche set
 // may have only 1-2 RC rows AT his first appearance year. The rule only
 // demotes thin signals that are ALSO late (>=2y gap), so a thin-but-early RC
 // (gap 0) is retained at high confidence.
 const nicheRookie=only([
  {meta:{sport:'Baseball',year:'2021'},rows:[{player:'Niche Rookie',tag:'RC'}]}
 ],'Niche Rookie');
 assert.equal(nicheRookie.rc_year,2021);
 assert.equal(nicheRookie.rc_year_confidence,'high');
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
