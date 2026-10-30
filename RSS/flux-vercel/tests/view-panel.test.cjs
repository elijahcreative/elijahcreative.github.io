const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const app=require('node:fs').readFileSync(require.resolve('../app.js'),'utf8');
test('View panel choices change layout without closing the panel',()=>{
 const start=app.indexOf("  _vPanel.addEventListener('click', ev => {");
 const end=app.indexOf("  _vPanel.addEventListener('change'",start);
 let handler,layout,closed=0;
 const box={_vPanel:{addEventListener:(_,fn)=>handler=fn},setLayout:value=>layout=value,activeNavWidget:{close:()=>closed++}};
 vm.runInNewContext(app.slice(start,end),box);
 handler({target:{closest:()=>({dataset:{layout:'flip'}})}});
 assert.equal(layout,'flip');assert.equal(closed,0);
});
test('View panel interaction pins hover-open panels and survives controls replaced during click',()=>{
 const start=app.indexOf('  const onDocPointer = ev => {',app.indexOf('function setupHoverTapPopup('));
 const end=app.indexOf('  const onClick = ev => {',start);
 const inside={},detached={closest:()=>null},outside={closest:()=>null};let closed=0;
 const popup={contains:t=>t===inside},trigger={contains:()=>false};
 const box={options:{keepOpenOnInteract:true},popup,trigger,isOpen:()=>true,close:()=>closed++,clearTimeout:()=>{},closeTimer:null,lastPointerType:'',pinnedByClick:false};
 vm.runInNewContext(app.slice(start,end)+';globalThis.pointer=onDocPointer;globalThis.click=onDocClick',box);
 box.pointer({pointerType:'mouse',target:inside});assert.equal(box.pinnedByClick,true);
 box.click({target:detached,composedPath:()=>[detached,popup]});assert.equal(closed,0);
 box.click({target:outside,composedPath:()=>[outside]});assert.equal(closed,1);
});
