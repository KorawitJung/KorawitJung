import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/maple.yml', import.meta.url), 'utf8');

test('only pushes to main can publish the tree', () => {
	assert.match(workflow, /push:\r?\n\s+branches: \[main\]\r?\n\s+paths:/);
});
test('a hung run is cut off after 5 minutes', () => {
	assert.match(workflow, /runs-on: ubuntu-latest\r?\n\s+timeout-minutes: 5/);
});
