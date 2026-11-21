import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { renderScene, FLOWER_CAPACITY } from './scene.mjs';

const QUERY = 'query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}';
const isCount = v => Number.isInteger(v) && v >= 0;

export function bangkokDate(now) {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now);
}

export async function fetchTodayCount({ login, token, now, fetchImpl = fetch }) {
	const today = bangkokDate(now);
	const res = await fetchImpl('https://api.github.com/graphql', {
		method: 'POST',
		headers: { authorization: `bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'maple-profile' },
		body: JSON.stringify({ query: QUERY, variables: { login, from: `${today}T00:00:00+07:00`, to: `${today}T23:59:59+07:00` } }),
	});
	if (!res.ok) throw new Error(`GitHub GraphQL returned HTTP ${res.status}`);
	const body = await res.json();
	if (body.errors?.length) throw new Error(`GitHub GraphQL error: ${body.errors.map(e => e.message).join('; ')}`);
	const weeks = body.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
	if (!Array.isArray(weeks)) throw new Error(`No contribution calendar for user ${login}`);
	const day = weeks.flatMap(w => w.contributionDays ?? []).find(d => d.date === today);
	if (!day) return 0;
	if (!isCount(day.contributionCount)) throw new Error(`Bad contributionCount for ${today}: ${day.contributionCount}`);
	return day.contributionCount;
}

export async function main(argv, env) {
	const { values } = parseArgs({ args: argv, options: { out: { type: 'string' }, count: { type: 'string' }, login: { type: 'string' } } });
	if (!values.out) throw new Error('--out <file> is required');
	const now = new Date();
	let count;
	if (values.count !== undefined) {
		count = /^\d+$/.test(values.count) ? Number(values.count) : NaN;
		if (!isCount(count)) throw new Error(`--count must be a non-negative integer, got ${values.count}`);
	} else {
		if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not set');
		const login = values.login ?? env.MAPLE_LOGIN ?? 'KorawitJung';
		count = await fetchTodayCount({ login, token: env.GITHUB_TOKEN, now });
	}
	const svg = renderScene(count);
	await writeFile(values.out, svg);
	console.log(`maple: ${bangkokDate(now)} ${count} contributions, ${Math.min(count, FLOWER_CAPACITY)} flowers`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main(process.argv.slice(2), process.env).catch(err => {
		console.error(`maple: ${err.message}`);
		process.exitCode = 1;
	});
}
