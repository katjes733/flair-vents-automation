# Test Suite Flake Investigation

- [Test Suite Flake Investigation](#test-suite-flake-investigation)
  - [Context](#context)
  - [What was ruled out, and how](#what-was-ruled-out-and-how)
  - [The actual mechanism found](#the-actual-mechanism-found)
  - [Reproduction methodology](#reproduction-methodology)
  - [Why no fix was applied](#why-no-fix-was-applied)
  - [If this needs revisiting](#if-this-needs-revisiting)
  - [A separate, unrelated flake found as a side effect](#a-separate-unrelated-flake-found-as-a-side-effect)

## Context

First observed 2026-09-08/09, during the same session as the setpoint-push termination bugfix (`tick.ts`'s "prompt termination" mechanism — see the git history around that fix for the actual bug it addresses; unrelated to this doc). Two separate full-suite runs (`bun run verify` / `bun run test:coverage`) each failed exactly one test, in a **different, unrelated file** each time:

- Run 1: `tests/server/routes/installationMembers.test.ts` → `POST /api/v1/installation-members/invite` → `propagates a service-layer rejection as its own status code` — expected `403`, got `404`.
- Run 2: a password-reset/verification route test — expected `200`, got a mismatched response.
- A third full run, immediately after, was completely clean (1510+/1510+ tests passed).

Every individually-failing test passed cleanly, every time, when its own file was run in isolation (`bunx vitest run <file>`). This ruled out "the test itself is wrong" from the very first observation — the question was always what's different about a *full* run.

## What was ruled out, and how

**Cross-file JS module-state leakage** (a module-level singleton, a cache, `globalThis` mutation surviving between test files sharing a worker) — the leading hypothesis going in, since Vitest's default pool model has historically been a source of this class of bug in other setups. **Disproven empirically**, not by assumption: a throwaway 20-file probe harness wrote a unique value to `globalThis` and logged `process.pid` from each file. Result: 20 distinct PIDs, and every file saw a freshly-unset global. Vitest 4.1.11 with this repo's config forks a brand-new OS process per test file — there is no process, and therefore no in-memory JS state, shared between files at all. This makes the "shared singleton" family of explanations structurally impossible here, not just unlikely.

**Real Redis/Postgres state leaking across test files** — also ruled out. Every route test file that touches `~/server/middleware/rateLimiter` or `~/server/util/redis` mocks it at the module level (confirmed directly in `installationMembers.test.ts`, `passwordReset.test.ts`, `signupVerification.test.ts`, `webauthn.test.ts`, `session.test.ts`, `account.test.ts`) — no real network call ever happens in these tests to begin with.

## The actual mechanism found

`supertest` calls `app.listen(0)` — binding a **fresh ephemeral TCP listener on `127.0.0.1`** — for essentially every individual assertion, not once per file (confirmed directly in `node_modules/supertest/lib/test.js`). Under heavy synthetic CPU/process contention (all cores pegged, worker pool deliberately oversubscribed well beyond the machine's real concurrency), real, well-formed HTTP responses were observed being delivered to the **wrong** concurrently in-flight request:

- `account.test.ts` — the client received a byte-identical `401 {success:false, message:"Unauthorized"}` even though `requireAuth`'s own 401 branch (`src/server/middleware/auth.ts:11`) provably never ran (confirmed via temporary debug instrumentation that never fired).
- `passwordReset.test.ts` — a request with an invalid email got back the `200` success response that belongs to a *different*, valid-email request.
- `session.test.ts` — expected `200`, got `404`.
- `webauthn.test.ts` — an unauthenticated route (`/login/options`, no auth requirement at all) got back a `401`.

In every case, the wrong value is a **real, correctly-formed response that exists somewhere else in the app** — never corrupted data, a timeout, or a crash. That pattern is consistent with response cross-delivery between two concurrently-live ephemeral loopback listeners under contention (a likely macOS loopback/port-reuse-under-starvation quirk), not with any bug in this app's own request-handling code. A direct, deliberate crosstalk probe (many concurrent identity-tagged requests against distinct ephemeral servers under the same stress) didn't itself catch a mismatch, but real route-test mismatches kept reproducing under the same conditions alongside it.

**Not pinned further**: the exact kernel/socket-layer trigger (e.g. whether it's specifically `SO_REUSEADDR` port churn, an OS-level accept-queue mixup, or something else) was not identified — that would need packet-level tracing, judged out of reasonable scope for this investigation.

## Reproduction methodology

- **0 failures across 14 clean full-suite runs** with no added load (8 plain `bun run test:coverage`, 6 with `--coverage`).
- Failures only appeared after adding **deliberate, artificial** stress: multiple `yes > /dev/null` processes pegging all 11 cores, plus Vitest worker oversubscription (`--maxWorkers=16–20`, well past the machine's real core count).
- Even under that induced stress, only a **handful of failures out of ~110 stressed attempts** — this is a genuinely rare event, not a coin-flip.

This is the single most important fact for judging priority: **under your actual, normal environment (no competing CPU load, default worker count), this has not reproduced even once in 14 tries.**

## Why no fix was applied

Two real fixes exist, and both have a real cost — this was left as a deliberate judgment call rather than picked unilaterally:

1. **The structural fix**: have each test file's `supertest` calls reuse one real listening server per file instead of binding a fresh one per assertion. This is the shared pattern across roughly 180 test files in this repo — correct in principle, but too broad a change to make safely as a side effect of chasing a rare flake.
2. **The cheap lever**: cap `maxWorkers` in `vitest.config.ts` to shrink how many concurrent ephemeral listeners can ever be alive at once. This has a **certain** cost (every `bun run verify`/`test:coverage` run gets slower, always) for an **uncertain** benefit (reducing an event that's already near-zero-probability under normal load).

Given the asymmetry — real, permanent slowdown vs. an already-rare, false-*failure* risk (not a false-*pass* risk; nothing incorrect ever slips through undetected, a spurious run just occasionally needs a re-run) — the recommendation was to leave `vitest.config.ts` untouched for now. This is recorded here specifically so that recommendation, and the reasoning behind it, isn't lost if the flake resurfaces and someone has to decide again whether it's finally worth the tradeoff.

## If this needs revisiting

- If this starts showing up in real CI runs (not just under deliberately-induced stress), that's the signal the tradeoff calculus above has changed — worth first checking whether the CI runner itself is under heavier real contention than local dev (shared runner, other concurrent jobs), which would explain a higher real-world hit rate than the 0/14 found here.
- The structural fix (one real listener per test file, not per assertion) is the actually-correct fix if this ever needs a real fix rather than a config-level mitigation — but it's a genuine ~180-file refactor of this repo's own established supertest-per-request convention, not a quick patch.
- The cheap mitigation (`vitest.config.ts`'s `poolOptions.forks.maxForks` or similar, capping worker concurrency) is still available and cheap to apply later if the calculus changes — just carries the permanent slowdown cost noted above.

## A separate, unrelated flake found as a side effect

While inducing stress to chase the mechanism above, `tests/client/components/settings/SystemParametersPage.test.tsx`'s "Show advanced parameters..." test hit a real `Test timed out in 15000ms` failure — even past its own existing `vi.setConfig({ testTimeout: 15000 })`. This is a **genuine RTL-rendering-timeout flake**, a different failure category entirely from the wrong-response crosstalk above (a slow/stuck render under extreme CPU starvation, not a network-layer mismatch). It also only appeared under the same artificial extreme stress, not in any of the 14 clean runs — flagged here for the record, not treated as urgent for the same reason.
