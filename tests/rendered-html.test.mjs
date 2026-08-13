import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html", host: "localhost" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the myHeadcountKT product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /myHeadcountKT/);
  assert.match(html, /Headcount &amp; Intervensi/);
  assert.match(html, /PORTAL GURU/);
  assert.match(html, /Selamat datang, Cikgu Aina/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("includes product-specific social metadata", async () => {
  const html = await (await render()).text();
  assert.match(html, /og:image/);
  assert.match(html, /og\.png/);
  assert.match(html, /Isi sekali\. Fahami perkembangan\. Bertindak tepat\./);
});
