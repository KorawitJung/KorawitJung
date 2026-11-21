import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderScene, FLOWER_CAPACITY } from './scene.mjs';

const count = (svg, re) => (svg.match(re) ?? []).length;
const flowers = svg => count(svg, /class="flower"/g);

test('same count gives byte-identical svg', () => {
	assert.equal(renderScene(17), renderScene(17));
});
test('draws one flower per contribution up to capacity', () => {
	for (const n of [0, 1, 17, FLOWER_CAPACITY]) assert.equal(flowers(renderScene(n)), n);
	assert.equal(flowers(renderScene(FLOWER_CAPACITY + 10)), FLOWER_CAPACITY);
	assert.equal(flowers(renderScene(500)), FLOWER_CAPACITY);
});
test('capacity is in the planned range', () => {
	assert.ok(FLOWER_CAPACITY >= 60 && FLOWER_CAPACITY <= 120, String(FLOWER_CAPACITY));
});
test('scene stays alive with zero flowers', () => {
	const svg = renderScene(0);
	assert.equal(count(svg, /class="leaf-fall"/g), 10);
	assert.ok(count(svg, /class="ripple"/g) > 20);
	assert.equal(count(svg, /<animateMotion/g), 2);
});
test('svg is safe and small enough for a README', () => {
	const svg = renderScene(500);
	assert.ok(svg.startsWith('<svg'));
	assert.ok(svg.includes('viewBox="0 0 640 320"'));
	assert.ok(!/<script/i.test(svg));
	assert.ok(Buffer.byteLength(svg) < 250_000, `${Buffer.byteLength(svg)} bytes`);
});
test('rejects a count that is not a non-negative integer', () => {
	for (const bad of [-1, 2.5, NaN]) assert.throws(() => renderScene(bad), RangeError);
});
