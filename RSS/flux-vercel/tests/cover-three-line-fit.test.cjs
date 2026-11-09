const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const fn = app.slice(app.indexOf('function fitFlipFrontCover('), app.indexOf('function handleFlipResize('));
function fit(naturalHeight) {
  const title = { style: { removeProperty() {} }, clientHeight: 100, get scrollHeight() { return naturalHeight(parseFloat(this.style.fontSize)); } };
  const copy = { clientWidth: 300, clientHeight: 500, children: [{ offsetHeight: 120 }], classList: { remove() {}, add() {} }, querySelector: () => title };
  const page = { querySelector: s => s === '.flip-cover-copy' ? copy : null };
  const box = { fitFlipCoverMasthead() {}, ensureFlipCoverFont: () => true, getComputedStyle: () => ({display:'block',rowGap:'0'}) };
  vm.runInNewContext(fn, box); box.fitFlipFrontCover(page);
  return parseFloat(title.style.fontSize);
}
test('short title keeps the large size', () => assert.equal(fit(() => 90), 129));
test('long title shrinks until it fits within the line limit', () => assert.equal(fit(size => size <= 59 ? 100 : 140), 59));
test('extreme headline retains readable minimum and can be truncated', () => assert.equal(fit(() => 180), 33));
