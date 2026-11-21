import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bangkokDate, fetchTodayCount, main } from './render.mjs';

const now = new Date('2026-11-21T07:35:00Z');
const reply = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });
const calendar = days => ({ data: { user: { contributionsCollection: { contributionCalendar: { weeks: [{ contributionDays: days }] } } } } });

test('bangkok date flips at 17:00Z', () => {
	assert.equal(bangkokDate(new Date('2026-11-20T16:59:59Z')), '2026-11-20');
	assert.equal(bangkokDate(new Date('2026-11-20T17:00:00Z')), '2026-11-21');
});
test('returns the count for today', async () => {
	const fetchImpl = reply(calendar([{ date: '2026-11-20', contributionCount: 17 }, { date: '2026-11-21', contributionCount: 2 }]));
	assert.equal(await fetchTodayCount({ login: 'KorawitJung', token: 't', now, fetchImpl }), 2);
});
test('missing day counts as zero', async () => {
	assert.equal(await fetchTodayCount({ login: 'KorawitJung', token: 't', now, fetchImpl: reply(calendar([])) }), 0);
});
test('graphql errors, null user, and http errors throw', async () => {
	const args = { login: 'KorawitJung', token: 't', now };
	await assert.rejects(fetchTodayCount({ ...args, fetchImpl: reply({ errors: [{ message: 'x' }] }) }));
	await assert.rejects(fetchTodayCount({ ...args, fetchImpl: reply({ data: { user: null } }) }));
	await assert.rejects(fetchTodayCount({ ...args, fetchImpl: reply({}, 502) }));
});
test('rejects an invalid --count', async () => {
	for (const bad of ['-1', '2.5', 'abc']) await assert.rejects(main(['--count', bad, '--out', 'x.svg'], {}));
});
test('without a token it fails and writes nothing', async () => {
	const { existsSync } = await import('node:fs');
	const { join } = await import('node:path');
	const { tmpdir } = await import('node:os');
	const out = join(tmpdir(), `maple-${process.pid}-${Date.now()}.svg`);
	await assert.rejects(main(['--out', out], {}), /GITHUB_TOKEN/);
	assert.equal(existsSync(out), false);
});
test('a negative --count gets the script message, not a parser error', async () => {
	for (const argv of [['--count', '-1', '--out', 'x.svg'], ['--count=-1', '--out', 'x.svg']]) {
		await assert.rejects(main(argv, {}), /non-negative integer/);
	}
});
