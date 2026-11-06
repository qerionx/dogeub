# Proxy speed work (branch `proxy-speed`, commit 966dcc8)

Raw data: `docs/proxy-speed-results.json`.

## What changed

- Boot: ready gate, parallel service worker and transport setup, retry cap, intent warmup on static builds.
- Scramjet: build-time patch of `scramjet.all.js` (cached IndexedDB handle, in-memory redirect trackers, registrable-domain memo, faster wasm decode and payload).
- Ultraviolet: faster URL codec (byte-identical output), JS rewriter skips nodes with no listeners, service worker only handles UV routes.
- Server: working Cache-Control, keep-alive, fast TCP socket and resolver, larger wisp send buffer, image proxy cache with ETag and 304, brotli precompression.

## Method

- Same machine, both builds served by Node on localhost: baseline = `HEAD~1` server and dist on `:2346`, new = this branch on `:2345`. Separate origins, so service workers and caches are isolated.
- Each round starts from wiped service workers, Cache Storage, IndexedDB and storage, then a reload so the proxy boots from scratch.
- Each site is loaded in a hidden 1280x800 iframe through each proxy (`/q/r/` Ultraviolet, `/k/` Scramjet). The time is navigation to the iframe `load` event.
- 3 loads per cell: the first, then two repeats. Two rounds per build, with the order swapped in round 2 (baseline first, then new; then new first, then baseline).
- Reported figures are medians across rounds. First load has n=2 per cell, repeat load n=4.
- Destination sites are the real internet, so they vary between runs.

## Results

Median load event time in ms, baseline to new. Negative change is faster.

| Site | Proxy | First load | Repeat load |
|---|---|---|---|
| YouTube | UV | 4060 to 2686 (-34%) | 1617 to 1293 (-20%) |
| YouTube | Scramjet | 5251 to 3923 (-25%) | 698 to 567 (-19%) |
| Reddit | UV | 2481 to 1813 (-27%) | 1550 to 1272 (-18%) |
| Reddit | Scramjet | 1824 to 1604 (-12%) | 1329 to 1290 (-3%) |
| Discord | UV | 2466 to 2096 (-15%) | 602 to 553 (-8%) |
| Wikipedia | UV | 495 to 555 (+12%) | 344 to 255 (-26%) |
| Wikipedia | Scramjet | hung on both builds | 332 to 279 (-16%) |
| GitHub | UV | 1131 to 1022 (-10%) | 279 to 270 (-3%) |
| GitHub | Scramjet | 1603 to 1352 (-16%) | 507 to 553 (+9%) |
| Google | UV | 981 to 884 (-10%) | 309 to 340 (+10%) |
| Google | Scramjet | 586 to 568 (-3%) | 324 to 337 (+4%) |
| Hacker News | UV | 481 to 486 (+1%) | 135 to 127 (-6%) |
| Hacker News | Scramjet | 261 to 253 (-3%) | 166 to 133 (-20%) |

Not comparable:

- Discord through Scramjet never finished loading on either build (20 s timeout, every load).
- Twitch through Scramjet failed in round 1 on both builds and loaded in round 2 on both.
- Twitch is also excluded from the table because its page content changed between runs (about 40 characters of text versus about 1,900 at the load event), so the load event does not mark the same state in each run. The measured change on UV was -54%, which should not be read as a speedup.

## Reading the numbers

- The pattern fits the changes: large, JS-heavy pages (YouTube, Reddit, Discord, warm Wikipedia) improve by roughly 10 to 35%; small pages (Google, Hacker News, warm GitHub) are within about 10% either way, which is inside the run-to-run noise here.
- Differences under about 10% should be treated as noise. Several cells (Google repeat, GitHub Scramjet repeat, Wikipedia UV first) moved the wrong way by that much.
- No site that loaded on the baseline failed on the new build, and no site that failed on the baseline started working because of these changes.
- The load event is not visual completion. YouTube's body text is empty at the load event on both builds, so its numbers measure the document and its blocking resources, not the app rendering.

## Other measurements

| Measurement | Baseline | New |
|---|---|---|
| Home page revisit (24 resources) | 19 revalidation requests | 0 requests |
| `x/a.mjs` over the wire with brotli | about 868 KB | 723 KB |
| Cache-Control on hashed chunks and assets | `max-age=0` | `immutable`, 1 year |
| Small request behind a bulk download, 10 MB/s (reviewer benchmark, wisp only) | 7681 ms | 430 ms |
| 100 MB download through wisp (reviewer benchmark) | stopped at 54.9 MB | completed |
| Scramjet PSL lookup in Node (reviewer benchmark) | 3.70 ms, 1807 IndexedDB opens | 0.002 ms, 1 open |

An earlier interleaved warm run (4 loads per cell, 2 rounds, alternating builds) showed Scramjet about 15% faster on MDN and Hacker News, and Ultraviolet unchanged.

## Not covered

- Throttled CPU or network, and lossy links. Everything above ran on a fast desktop with a loopback server.
- True cold start on the static build, which uses remote wisp servers.
- Deployment on Render or GCS, where cache headers and compression come from the host.
- Known problems that exist on both builds and were not touched: Scramjet's first load of Wikipedia hangs, and Scramjet does not load Discord.
