import { describe, expect, it } from "bun:test";
import { IssueLabel, type LinearClient } from "@linear/sdk";
import { resolveLabelIds } from "../../src/lib/resolve.js";
import { connection } from "../unit/_fakes.js";

// Controlled latency, not a live Linear benchmark. Run separately from verify so
// wall-clock assertions are not affected by the full suite's parallel workload.
const REQUEST_DELAY_MS = 30;
const SAMPLES = 3;
const TEAM_ID = "team";

type Resolver = typeof resolveLabelIds;

// The pre-fix successful, single-page path: sequential name searches followed
// by lazy team fetches. Error handling is intentionally omitted from the baseline
// because these fixtures only measure successful, unambiguous resolutions.
const sequentialBaseline: Resolver = async (client, names, teamId) => {
  const ids: string[] = [];
  for (const name of names) {
    const page = await client.issueLabels({ filter: { name: { eqIgnoreCase: name } } });
    const scoped = await Promise.all(
      page.nodes.map(async (label) => ({ label, team: await label.team })),
    );
    const candidates = scoped.filter(({ team }) => !team || team.id === teamId);
    ids.push(candidates[0]!.label.id);
  }
  return ids;
};

async function measure(resolve: Resolver, names: string[], teamScoped: boolean) {
  let searches = 0;
  let teamFetches = 0;
  let active = 0;
  let maxConcurrent = 0;
  async function request<T>(value: T): Promise<T> {
    active++;
    maxConcurrent = Math.max(maxConcurrent, active);
    try {
      await Bun.sleep(REQUEST_DELAY_MS);
      return value;
    } finally {
      active--;
    }
  }
  const client = {
    issueLabels: async ({ filter }: any) => {
      searches++;
      const name = filter.name.eqIgnoreCase;
      const label = new IssueLabel(
        (async () => {
          teamFetches++;
          return request({ team: { id: TEAM_ID } });
        }) as any,
        { id: name, name, isGroup: false, team: teamScoped ? { id: TEAM_ID } : null } as any,
      );
      return request(connection([label]));
    },
  } as unknown as LinearClient;
  const started = performance.now();
  const ids = await resolve(client, names, TEAM_ID);
  const elapsedMs = performance.now() - started;
  expect(ids).toEqual(names);
  return { elapsedMs, searches, teamFetches, maxConcurrent };
}

function median(values: number[]) {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
}

describe("label resolution performance (simulated 30 ms requests)", () => {
  it("coalesces six repeated names into one request", async () => {
    const names = Array.from({ length: 6 }, () => "Bug");
    // Separate resolver calls reproduce concurrent searches without sharing a cache.
    const uncached: Resolver = (client, inputs, teamId) =>
      Promise.all(inputs.map(async (name) => (await resolveLabelIds(client, [name], teamId))[0]!));
    const before: number[] = [];
    const after: number[] = [];
    for (let sample = 0; sample < SAMPLES; sample++) {
      const old = await measure(uncached, names, true);
      const current = await measure(resolveLabelIds, names, true);
      expect(old.searches).toBe(6);
      expect(current.searches).toBe(1);
      expect(current.teamFetches).toBe(0);
      before.push(old.elapsedMs);
      after.push(current.elapsedMs);
    }
    // Both versions overlap their requests: caching reduces API load, not the
    // simulated network critical path. Do not assert a fictitious latency win.
    console.log(
      JSON.stringify({
        scenario: "six duplicate labels",
        simulatedRequestMs: REQUEST_DELAY_MS,
        samples: SAMPLES,
        uncachedMedianMs: +median(before).toFixed(1),
        cachedMedianMs: +median(after).toFixed(1),
        uncachedRequests: 6,
        cachedRequests: 1,
      }),
    );
  });

  for (const teamScoped of [true, false]) {
    for (const count of [1, 3, 6]) {
      it(`${count} ${teamScoped ? "team" : "workspace"} labels`, async () => {
        const names = Array.from({ length: count }, (_, i) => `Label ${i}`);
        const before: number[] = [];
        const after: number[] = [];
        for (let sample = 0; sample < SAMPLES; sample++) {
          // Alternate order to reduce systematic warm-up/order bias.
          const [old, current] =
            sample % 2 === 0
              ? [
                  await measure(sequentialBaseline, names, teamScoped),
                  await measure(resolveLabelIds, names, teamScoped),
                ]
              : await (async () => {
                  const current = await measure(resolveLabelIds, names, teamScoped);
                  return [await measure(sequentialBaseline, names, teamScoped), current] as const;
                })();
          expect(old.searches).toBe(count);
          expect(old.teamFetches).toBe(teamScoped ? count : 0);
          expect(old.maxConcurrent).toBe(1);
          expect(current.searches).toBe(count);
          expect(current.teamFetches).toBe(0);
          expect(current.maxConcurrent).toBe(count);
          before.push(old.elapsedMs);
          after.push(current.elapsedMs);
        }
        const oldMs = median(before);
        const currentMs = median(after);
        console.log(
          JSON.stringify({
            scope: teamScoped ? "team" : "workspace",
            labels: count,
            simulatedRequestMs: REQUEST_DELAY_MS,
            samples: SAMPLES,
            baselineMedianMs: +oldMs.toFixed(1),
            currentMedianMs: +currentMs.toFixed(1),
            speedup: +(oldMs / currentMs).toFixed(2),
            baselineRequests: count * (teamScoped ? 2 : 1),
            currentRequests: count,
          }),
        );
        // Deliberately loose: expected six-label ratios are 12x and 6x.
        if (count === 6) expect(currentMs).toBeLessThan(oldMs / 2);
      });
    }
  }
});
