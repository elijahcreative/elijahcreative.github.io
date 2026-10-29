const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const move = source.slice(source.indexOf('function handleFlipTouchMove('), source.indexOf('function handleFlipTouchEnd('));
for (const direction of [1, -1]) {
  test(`turn ${direction}: reversing through touch origin stays at rest until lifted`, () => {
    const sandbox = {
      flipGesture: {axis:'y', direction, pairIndex:0, startX:100, startY:400, lastY:400, lastTime:1, velocity:0},
      flipAnimating:false, window:{innerHeight:800}, performance:{now:()=>1},
      flipOverlay:{querySelector:()=>({})}, setFlipAngle:()=>{}, setFlipCastShadow:()=>{}
    };
    vm.createContext(sandbox); vm.runInContext(move,sandbox);
    let time=10;
    const drag = displacement => {
      sandbox.handleFlipTouchMove({touches:[{clientX:100,clientY:400-direction*displacement}],timeStamp:time+=10,preventDefault(){}});
      return sandbox.flipGesture.progress;
    };
    const lifted=drag(60); assert.ok(lifted>0);
    assert.ok(drag(20)<lifted);
    assert.equal(drag(0),0);
    assert.equal(drag(-30),0);
    assert.equal(drag(-90),0);
    assert.equal(sandbox.flipGesture.angle,direction===1?0:180);
    assert.ok(drag(40)>0); // Same touch can return along the original turn direction.
  });
}
