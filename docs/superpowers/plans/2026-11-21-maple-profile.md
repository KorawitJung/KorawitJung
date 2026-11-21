# Maple profile tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put an animated pixel-art maple scene on the KorawitJung GitHub profile, with one red flower per contribution made today (Bangkok time), refreshed every hour.

**Architecture:** A pure function `renderScene(count)` turns a flower count into a self-contained animated SVG string. A thin entry script fetches today's count from the GitHub GraphQL API and writes the file. A scheduled workflow runs the script and force-pushes the SVG as the only file on an orphan `output` branch, which the README embeds above the existing koi.

**Tech Stack:** Node (>= 20, built-in `fetch` and `node:test`, zero dependencies), GitHub Actions, SVG with CSS keyframes and SMIL `<animateMotion>`.

**Spec:** `docs/superpowers/specs/2026-11-21-maple-profile-design.md`. Approved look: `docs/superpowers/specs/2026-11-21-maple-mockup-v2.html`.

## Global Constraints

- The SVG contains no `<script>`. Animation is CSS `@keyframes` or SMIL only.
- Scene grid is 128 x 64 cells of 5 px: `viewBox="0 0 640 320"`, `shape-rendering="crispEdges"`.
- Scene RNG is mulberry32 with seed 21. Flower placement RNG is mulberry32 with seed 5.
- Layers, palettes, bushes, bench, outlines, and all coordinates are ported verbatim from the mockup v2 `<script>`.
- One flower per contribution. Draw the first `min(n, FLOWER_CAPACITY)` spots in a fixed order. Never stack flowers.
- Flower petals `#D7263D`, center `#FFE08A`. Bloom uses `steps(3)`. Bloom delay of flower `i` is `0.3 + i * min(0.12, 6 / n)` seconds.
- Falling leaves: 10, in two waves of 5, 3.5 s apart, 7 s cycle. Drifting leaves on the stream: 2, 16 s cycle, 8 s apart.
- "Today" is the current date in `Asia/Bangkok` at run time.
- The workflow never writes to `main` and never uses concurrency group `koi`.
- Use the workflow's `GITHUB_TOKEN`. If it cannot read the data, stop and ask the owner. Never create or request a token.
- Publishing uses identity `github-actions[bot]` / `41898282+github-actions[bot]@users.noreply.github.com`.
- Local commits only. Pushing to `KorawitJung/KorawitJung` needs the owner's confirmation in chat.

## Review Focus

- A day with 0 contributions: no flowers, but falling leaves, ripples, and drifting leaves still animate, so the tree never looks dead.
- A huge day (500 contributions): exactly `FLOWER_CAPACITY` flowers, and the file stays under the size budget.
- A GraphQL response with HTTP 200 and an `errors` array, or with `user: null`: the script fails and writes nothing, so the old image stays.
- A run at 16:59:59Z versus 17:00:00Z: the Bangkok date flips at 17:00Z, not at UTC midnight.
- An invalid `--count` such as `-1`, `2.5`, or `abc`: the script refuses with a message instead of drawing a broken tree.

---

### Task 1: Scene renderer

**Files:**
- Create: `scripts/maple/scene.mjs`
- Test: `scripts/maple/scene.test.mjs`
- Create: `.gitignore` with the line `preview.svg`
- Commit also: `docs/superpowers/` (spec, mockup, this plan)

**Interfaces:**
- Consumes: nothing.
- Produces: `renderScene(count: number): string` and `FLOWER_CAPACITY: number`, both exported from `scripts/maple/scene.mjs`. Each flower is a `<g class="flower" ...>`. Each falling leaf has class `leaf-fall`. Each ripple has class `ripple`. Each drifting leaf contains one `<animateMotion>`.

- [ ] **Step 1: Set the repo-local git identity**

Run: `git config user.name KorawitJung` and `git config user.email 79323004+KorawitJung@users.noreply.github.com`
Expected: `git config user.email` prints the noreply address. Commits made with it count as the owner's contributions.

- [ ] **Step 2: Write the failing tests**

```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test scripts/maple/`
Expected: FAIL with `Cannot find module` for `scene.mjs`.

- [ ] **Step 4: Implement `renderScene(count)` and `FLOWER_CAPACITY` in `scripts/maple/scene.mjs`**

Port the mockup's scene code as a pure module. Keep its data shape: a color grid `G[y][x]` plus an owner grid `M[y][x]` (`'leaf'`, `'trunk'`, `'bench'`, or `null`), with the outline pass reading `M`. Build the static scene and the spot list once at module load, so `renderScene` only adds flowers. Decisions the mockup does not make for you:
	- Static pixels: emit one `<path fill="#rrggbb" d="M{x} {y}h{w}v5h-{w}z...">` per distinct color, made from the same horizontal runs the mockup merges. That keeps the file under budget.
	- Spots: same rule as the mockup (`cells` with `d < .62`, Manhattan distance `> 3`) but try up to 20 000 times with no 60 cap. `FLOWER_CAPACITY` is the resulting spot count.
	- Falling leaves: emit `@keyframes fall0` to `fall9`, one per leaf, with its own literal x offsets. Do not use CSS custom properties.
	- Drifting leaves: SMIL `<animateMotion path="..." dur="16s" begin="{0|8}s" repeatCount="indefinite"/>` plus an `<animate attributeName="opacity">` for the fade, along the same stream path as the mockup. Do not use `offset-path`.
	- Flower bloom and ripple delays go in inline `style="animation-delay:..."` attributes. Put all keyframes in one `<style>` element inside the SVG.
	- Validate input at the top: `count` must be a non-negative integer, otherwise throw `RangeError`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test scripts/maple/`
Expected: PASS, 5 tests. If the size test fails, report the byte count before changing the encoding.

- [ ] **Step 6: Compare against the mockup**

Write `preview.svg` with `node -e "import('./scripts/maple/scene.mjs').then(m=>require('fs').writeFileSync('preview.svg',m.renderScene(17)))"`. Open an HTML page that shows it through `<img src="preview.svg">` in the browser pane, next to the mockup set to 17.
Expected: the same scene, flowers bloom, 5 leaves fall at a time, ripples blink, and 2 leaves drift down the stream. All of it plays inside `<img>`.

- [ ] **Step 7: Commit**

```bash
git add .gitignore scripts/maple/scene.mjs scripts/maple/scene.test.mjs docs/superpowers
git commit -m "maple: render the profile scene as an animated svg"
```

### Task 2: Entry script and data fetch

**Files:**
- Create: `scripts/maple/render.mjs`
- Test: `scripts/maple/render.test.mjs`

**Interfaces:**
- Consumes: `renderScene`, `FLOWER_CAPACITY` from Task 1.
- Produces: CLI `node scripts/maple/render.mjs --out <file> [--count <n>] [--login <name>]`. Without `--count` it reads `GITHUB_TOKEN` and fetches. `--login` defaults to env `MAPLE_LOGIN`, then `KorawitJung`. Exports `bangkokDate(now: Date): string`, `fetchTodayCount({ login, token, now, fetchImpl }): Promise<number>`, and `main(argv: string[], env: object): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/maple/`
Expected: Task 1 tests PASS, the new tests FAIL with `Cannot find module` for `render.mjs`.

- [ ] **Step 3: Implement `scripts/maple/render.mjs`**

	- `bangkokDate` uses `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' })`, which prints `YYYY-MM-DD`.
	- `fetchTodayCount` POSTs to `https://api.github.com/graphql` with `Authorization: bearer <token>` and the query `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`, where `from` is `${today}T00:00:00+07:00` and `to` is `${today}T23:59:59+07:00`. It throws on a non-ok status, an `errors` array, a missing user, or a `contributionCount` that is not a non-negative integer.
	- `main` parses arguments with `node:util` `parseArgs`. With `--count`, it validates the value as a non-negative integer and skips the network. Without `--count`, it throws if `GITHUB_TOKEN` is unset. It renders the SVG fully in memory and calls `writeFile` only after success, so a failure leaves the old file untouched. It logs `maple: <date> <count> contributions, <drawn> flowers`.
	- Run `main(process.argv.slice(2), process.env)` only when the file is the entry point, by comparing `import.meta.url` with `pathToFileURL(process.argv[1]).href`. On error, print the message and set `process.exitCode = 1`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/maple/`
Expected: PASS, 10 tests.

- [ ] **Step 5: Check the live API locally**

Run: `GITHUB_TOKEN=$(gh auth token) node scripts/maple/render.mjs --out preview.svg`
Expected: the log line shows today's Bangkok date and a count that matches `gh api graphql` for the same window.

- [ ] **Step 6: Commit**

```bash
git add scripts/maple/render.mjs scripts/maple/render.test.mjs
git commit -m "maple: fetch today's contributions and write the svg"
```

### Task 3: Workflow and README

**Files:**
- Create: `.github/workflows/maple.yml`
- Modify: `README.md`, insert after line 1 (`# Hi, I'm Korawit 👋`) and before the koi `<p align="center">` block

**Interfaces:**
- Consumes: the CLI from Task 2.
- Produces: branch `output` holding only `maple.svg`, served at `https://raw.githubusercontent.com/KorawitJung/KorawitJung/output/maple.svg`.

- [ ] **Step 1: Write `.github/workflows/maple.yml`**

	- `name: Maple`.
	- `on.schedule`: `cron: "17 * * * *"`, `cron: "30 16 * * *"`, and `cron: "50 16 * * *"`. Also `workflow_dispatch`, and `push` with `paths: [scripts/maple/**, .github/workflows/maple.yml]`.
	- `permissions: contents: write` and `concurrency: maple`.
	- One job on `ubuntu-latest`. Steps:
		1. `actions/checkout@v7`, the same version koi uses.
		2. `node --test scripts/maple/`.
		3. `node scripts/maple/render.mjs --out "$RUNNER_TEMP/maple.svg"` with env `GITHUB_TOKEN: ${{ github.token }}` and `MAPLE_LOGIN: ${{ github.repository_owner }}`.
		4. A bash publish step with env `GITHUB_TOKEN: ${{ github.token }}`:

```bash
if git fetch --quiet --depth=1 origin output 2>/dev/null \
	&& git show FETCH_HEAD:maple.svg > "$RUNNER_TEMP/old.svg" 2>/dev/null \
	&& cmp -s "$RUNNER_TEMP/old.svg" "$RUNNER_TEMP/maple.svg"; then
	echo "The maple is unchanged; nothing to publish."
	exit 0
fi
pub="$RUNNER_TEMP/pub"
mkdir "$pub" && cp "$RUNNER_TEMP/maple.svg" "$pub/"
cd "$pub"
git init --quiet --initial-branch=output
git add maple.svg
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit --quiet --message "maple: draw today's tree"
git push --quiet --force "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" output
```

- [ ] **Step 2: Add the maple block to `README.md`**

Insert this block, with one blank line on each side, between the heading and the koi block. Leave the koi block unchanged:

```html
<p align="center">
  <img src="https://raw.githubusercontent.com/KorawitJung/KorawitJung/output/maple.svg" width="100%" alt="ต้นเมเปิลสีเหลืองริมลำธาร ดอกสีแดงแต่ละดอกคือหนึ่ง contribution ของวันนี้" />
</p>
```

- [ ] **Step 3: Check the workflow file parses**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/maple.yml','utf8');for(const k of ['17 * * * *','30 16 * * *','50 16 * * *','concurrency: maple','contents: write'])if(!y.includes(k))throw k;console.log('ok')"`
Expected: `ok`. If `actionlint` is installed, also run `actionlint .github/workflows/maple.yml` and expect no output.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/maple.yml README.md
git commit -m "maple: publish hourly to the output branch and show it on the profile"
```

### Task 4: Ship and verify on GitHub

**Files:** none.

**Interfaces:**
- Consumes: commits from Tasks 1 to 3.
- Produces: the live profile.

- [ ] **Step 1: Ask the owner to confirm the push**

Show `git log --oneline origin/main..HEAD` and ask in chat. Do not push without a yes.

- [ ] **Step 2: Push**

Run: `git push origin main`
Expected: the push triggers the `Maple` workflow through its `push.paths` filter.

- [ ] **Step 3: Watch the first run**

Run: `gh run list --workflow maple.yml --limit 1`, then `gh run view <id> --log` once it finishes.
Expected: tests pass, the log line shows today's Bangkok date and count, and the publish step pushes `output`. If the GraphQL call fails with a permission error, stop and ask the owner. Do not add a token.

- [ ] **Step 4: Check the published file**

Run: `gh api repos/KorawitJung/KorawitJung/contents/maple.svg?ref=output --jq .size`
Expected: a size under 250 000 bytes. A second `gh workflow run maple.yml` on the same day ends with "The maple is unchanged; nothing to publish."

- [ ] **Step 5: Check the profile in the browser pane**

Open `https://github.com/KorawitJung` in light and in dark theme.
Expected: the maple scene animates above the koi, the flower count matches today's contributions, and the koi still shows. Take a screenshot for the owner.
