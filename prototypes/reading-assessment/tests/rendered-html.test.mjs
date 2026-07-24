import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Reading Edge assessment shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Reading Edge/);
  assert.match(html, /阅读难度定位原型/);
  assert.match(html, /12/);
  assert.match(html, /固定套题/);
  assert.match(html, /六个/);
  assert.match(html, /Rule-based MVP/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

test("source connects all six levels to the fixed pack library", async () => {
  const [page, packs, engine, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/test-packs.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/assessment-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /PACK_LIBRARY\[inference\.band\]/);
  assert.match(
    page,
    /import\s*\{[\s\S]*?\bclampBand\b[\s\S]*?\}\s*from\s*["']\.\/assessment-engine["']/,
  );
  assert.match(page, /stage === "reading"/);
  assert.match(page, /stage === "result"/);
  assert.doesNotMatch(page, /setStage\("skipped"\)/);
  assert.match(page, /question\.type/);
  assert.match(page, /lookupFrequency/);
  assert.match(page, /同级 B 卷复核/);
  for (const band of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
    assert.match(packs, new RegExp(`\\n  ${band}: \\[`));
  }
  assert.match(engine, /weightedMedian/);
  assert.match(engine, /CET-6 内部起始规则/);
  assert.match(engine, /bandFromToeflNew/);
  assert.match(layout, /lang="zh-CN"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
