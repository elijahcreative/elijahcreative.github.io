const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const script = app.slice(app.indexOf('function ensureFlipCoverFont('), app.indexOf('function handleFlipResize('));
function fixture() {
 let resolveFont, calls = 0, primes = 0, measured = 0;
 const fontReady = new Promise(resolve => { resolveFont = resolve; });
 const style = { removeProperty(name) { delete this[name]; } };
 const title = { style, clientHeight: 100, get scrollHeight() { measured++; return parseFloat(style.fontSize) > 59 ? 140 : 100; } };
 const copy = { clientWidth: 300, clientHeight: 500, children: [{ offsetHeight: 120 }], classList: { remove() {}, add() {} }, querySelector: () => title };
 const page = { querySelector: selector => selector === '.flip-cover-copy' ? copy : selector === '.flip-cover-title' ? title : null };
 const sandbox = { S:{layout:'flip'}, document:{fonts:{load:()=>{calls++;return fontReady;}}},
   $:()=>({querySelector:()=>page}), fitFlipCoverMasthead(){}, getComputedStyle:()=>({display:'block',rowGap:'0'}), primeFlipOverlay:()=>primes++ };
 const context = vm.createContext(sandbox);
 vm.runInContext("let flipCoverFontState='idle', flipCoverFontFitPending=false, flipGesture=null, flipAnimating=false, flipRewinding=false, flipPreparedPair=null;\n"+script,context);
 return {context, sandbox, page, title, resolveFont, get calls(){return calls;}, get primes(){return primes;},get measured(){return measured;}};
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('cold font is loaded before first headline measurement; refits keep identical geometry', async () => {
 const f=fixture(); f.sandbox.fitFlipFrontCover(f.page); f.sandbox.fitFlipFrontCover(f.page);
 assert.equal(f.title.style.visibility,'hidden'); assert.equal(f.measured,0);
 await tick(); assert.equal(f.calls,1); f.resolveFont([{}]); await tick();
 assert.equal(f.title.style.visibility,undefined); assert.equal(f.title.style.fontSize,'59px'); assert.equal(f.primes,1);
 f.sandbox.fitFlipFrontCover(f.page); assert.equal(f.title.style.fontSize,'59px');
});
test('a font arriving during a turn waits for the turn to finish before fitting', async () => {
 const f=fixture(); f.sandbox.fitFlipFrontCover(f.page); vm.runInContext('flipAnimating=true',f.context);
 await tick(); f.resolveFont([{}]); await tick(); assert.equal(f.title.style.visibility,'hidden'); assert.equal(f.measured,0);
 vm.runInContext('flipAnimating=false; flushFlipCoverFontFit()',f.context);
 assert.equal(f.title.style.fontSize,'59px'); assert.equal(f.title.style.visibility,undefined);
});
test('a failed font load still reveals a fitted readable fallback', async () => {
 const f=fixture(); f.sandbox.fitFlipFrontCover(f.page); await tick(); f.resolveFont([]); await tick();
 assert.equal(f.title.style.visibility,undefined); assert.equal(f.title.style.fontSize,'59px');
});
