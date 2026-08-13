import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.match(html, /Log masuk ke myHeadcountKT/);
  assert.match(html, /Data murid tidak dipaparkan sebelum login/);
  assert.doesNotMatch(html, /PORTAL GURU|Selamat datang, Pengguna Google/);
  assert.doesNotMatch(html, /Cikgu Aina|Nur Aina Binti Ahmad/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("loads and updates the authenticated Google Sheets profile", async () => {
  const [appSource, serviceSource, backendSource] = await Promise.all([
    readFile(new URL("../app/headcount-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /ProfileModal/);
  assert.match(appSource, /saveProfileName/);
  assert.match(appSource, /authStatus!=="signed-in"/);
  assert.match(appSource, /function LoginScreen/);
  assert.doesNotMatch(appSource, /Cikgu Aina|Nur Aina Binti Ahmad/);
  assert.match(serviceSource, /getProfile/);
  assert.match(serviceSource, /saveProfile/);
  assert.match(backendSource, /getProfile: getProfile_/);
  assert.match(backendSource, /saveProfile: saveProfile_/);
});

test("includes product-specific social metadata", async () => {
  const html = await (await render()).text();
  assert.match(html, /og:image/);
  assert.match(html, /og\.png/);
  assert.match(html, /Isi sekali\. Fahami perkembangan\. Bertindak tepat\./);
});
