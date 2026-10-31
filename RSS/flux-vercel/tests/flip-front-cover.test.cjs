const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(require.resolve('../app.js'),'utf8');
const start = app.indexOf('function flipFrontCoverSelection(');
const end = app.indexOf('\n};',app.indexOf('const Renderer = {',start))+3;
function renderer() {
  const box = {S:{feeds:[],sectionView:false,showYoutube:true,flipFrontCover:false,lastUpdated:'2026-10-29T10:00:00Z'},
    DEFAULT_FEEDS:[],flipImageChoices:new Map(),flipTextLayoutMode:null,
    flipImageKey:a=>a.url+'|'+a.image, aid:a=>a.id,e:s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
    normalizeText:s=>String(s||'').trim(),flipTextPageSpec:()=>({mode:'test',rows:3,columns:2,count:6})};
  vm.runInNewContext(app.slice(start,end)+';globalThis.render=Renderer;globalThis.select=flipFrontCoverSelection',box);
  return box;
}
const articles=Array.from({length:9},(_,i)=>({id:'a'+i,url:'https://example.test/'+i,image:'https://example.test/'+i+'.jpg',title:'Ez egy megfelelő hosszúságú valódi hír címe '+i,feedUrl:'feed'+i%3,feedName:'Forrás '+i,date:new Date('2026-10-29T10:00:00Z')}));
test('opt-in adds one distinct page zero, preserving all normal pages, articles and numbering',()=>{
 const r=renderer();const normal=r.render._flip(articles);r.S.flipFrontCover=true;const cover=r.render._flip(articles);
 const front=cover.match(/<section class="flip-page flip-page-frontcover"[\s\S]*?<\/section>/)?.[0];assert.ok(front);assert.ok(front.includes('00 / '+String((normal.match(/<section /g)||[]).length).padStart(2,'0')));
 assert.equal(cover.replace(front,''),normal);
 assert.doesNotMatch(front,/flip-cover-source/);assert.match(front,/data-cover-next/);assert.match(front,/data-id="a0"/);
 assert.equal((cover.match(/flip-cover-teaser"/g)||[]).length,2);
});
test('selection is deterministic, unique, handles missing photos, empty feeds and long headlines',()=>{
 const r=renderer();assert.equal(r.select([]),null);const one=r.select([articles[0]]);assert.equal(one.teasers.length,0);
 assert.equal(r.select(articles).lead.id,r.select(articles).lead.id);
 const fallback=r.select([{...articles[0],image:null,title:'x'.repeat(300)}]);assert.equal(fallback.lead.id,'a0');
 assert.equal(r.select([articles[0],articles[0]]).teasers.length,0);
});
test('cover anchor survives rerenders as the cover instead of jumping to its lead article',()=>{
 const fn=app.slice(app.indexOf('function currentFlipAnchor()'),app.indexOf('function restoreFlipAnchor('));
 const page={dataset:{flipAnchor:'frontcover'},querySelector:()=>({dataset:{id:'lead'}})};
 const box={S:{layout:'flip'},flipPageIndex:0,$:()=>({querySelectorAll:()=>[page]})};vm.runInNewContext(fn,box);assert.equal(box.currentFlipAnchor(),'frontcover');
});
test('View menu cover switch is visible only in Flip, without changing its saved value',()=>{
 const source=app.slice(app.indexOf('function updateLayoutBtns()'),app.indexOf('function setLayout('));
 const row={hidden:false};const box={S:{layout:'magazine',flipFrontCover:true},$:()=>row,document:{querySelectorAll:()=>[]}};
 vm.runInNewContext(source,box);
 for (const layout of ['magazine','grid','list','reader','flip','magazine']) {
  box.S.layout=layout;box.updateLayoutBtns();assert.equal(row.hidden,layout!=='flip');assert.equal(box.S.flipFrontCover,true);
 }
});
test('prepared cover faces receive final typography, teaser visibility and full-page dimensions',()=>{
 const fn=app.slice(app.indexOf('function syncFlipFrontCoverState('),app.indexOf('function syncFlipCloneState('));
 const selectors=['.flip-cover-masthead','.flip-cover-copy','.flip-cover-title'];
 const from=Object.fromEntries(selectors.map((s,i)=>[s,{style:{cssText:`font-size: ${140-i*20}px`},className:i===1?'flip-cover-copy trim-one':'type'}]));
 const to=Object.fromEntries(selectors.map(s=>[s,{style:{cssText:'font-size: 28px'},className:'old'}]));
 const source={offsetWidth:390,offsetHeight:720,querySelector:s=>from[s]};
 const target={style:{},querySelector:s=>to[s]};
 const box={};vm.runInNewContext(fn,box);box.syncFlipFrontCoverState({querySelector:()=>source},{querySelector:()=>target});
 assert.equal(target.style.width,'390px');assert.equal(target.style.height,'720px');
 for (const s of selectors) {assert.equal(to[s].style.cssText,from[s].style.cssText);assert.equal(to[s].className,from[s].className)}
});
test('the visible cover is fitted synchronously before deferred image/contrast work',()=>{
 const fn=app.slice(app.indexOf('function setFlipPage('),app.indexOf('function beginFlipGesture('));
 const events=[],deferred=[];const page={dataset:{},classList:{toggle(){}},querySelector:()=>null};
 const box={flipPageIndex:0,$:()=>({querySelectorAll:()=>[page],scrollTop:0}),clearFlipTurnPages:()=>{},fitFlipFrontCover:()=>events.push('fit'),requestAnimationFrame:f=>deferred.push(f)};
 vm.runInNewContext(fn,box);box.setFlipPage(0);assert.deepEqual(events,['fit']);assert.equal(deferred.length,1);
});
test('cover retains the normal toolbar without immersive photo layers',()=>{
 assert.doesNotMatch(app,/syncFlipCoverChrome|flipCoverHeaderMedia/);
 const css=fs.readFileSync(require.resolve('../styles.css'),'utf8');
 assert.doesNotMatch(css,/\.navbar\.is-cover|flip-cover-header-media/);
});

test('masthead glass keeps visible word width on resize and one shared mask on prepared faces',()=>{
 const fn=app.slice(app.indexOf('function fitFlipCoverMasthead('),app.indexOf('function fitFlipFrontCover('));
 const props={},classes=new Set();
 const masthead={parentElement:{clientWidth:351},style:{setProperty:(key,value)=>props[key]=value},classList:{add:value=>classes.add(value)}};
 const box={flipCoverWordMask:()=>({url:'data:image/png;base64,word',ratio:.28})};
 vm.runInNewContext(fn,box);
 box.fitFlipCoverMasthead(masthead);assert.ok(Math.abs(parseFloat(masthead.style.height)-98.28)<.001);
 masthead.parentElement.clientWidth=720;box.fitFlipCoverMasthead(masthead);
 assert.ok(Math.abs(parseFloat(masthead.style.height)-201.6)<.001);
 assert.equal(props['--cover-word-mask'],'url("data:image/png;base64,word")');
 assert.ok(classes.has('is-frosted'));
});
test('older browsers keep readable masthead text when the blur mask is unavailable',()=>{
 const fn=app.slice(app.indexOf('function fitFlipCoverMasthead('),app.indexOf('function fitFlipFrontCover('));
 const masthead={parentElement:{clientWidth:351},style:{},classList:{add:()=>assert.fail('must not hide fallback')}};
 const box={flipCoverWordMask:()=>null,document:{createRange:()=>({selectNodeContents(){},getBoundingClientRect:()=>({width:200})})}};
 vm.runInNewContext(fn,box);box.fitFlipCoverMasthead(masthead);assert.equal(masthead.style.fontSize,'175.5px');
});
