import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
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

test("server-renders the Chiến lược trainer", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="it">/i);
  assert.match(html, /<title>Chiến lược Trainer · Bảo Lan<\/title>/i);
  assert.match(html, /Allenati come/);
  assert.match(html, /Quale esame prepari\?/);
  assert.match(html, /2º–3º Đẳng/);
  assert.match(html, /4º Đẳng/);
  assert.match(html, /Palestra Bao Lan/);
  assert.match(html, /Paolo Pasquetto · Bao Chien/);
  assert.match(html, /images\/logo-baolan\.jpg/);
  assert.match(html, /images\/logo-viet-vo-dao-italia\.png/);
  assert.match(html, /https:\/\/paypal\.me\/paolopasquetto/);
  assert.equal((html.match(/Ringraziamenti/g) ?? []).length, 1);
  assert.doesNotMatch(html, />Grazie</);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("packages all prompts, selection theme, and completion audio", async () => {
  const sizes = await Promise.all(
    [
      ...Array.from({ length: 30 }, (_, index) => `${index + 1}.mp3`),
      "theme.mp3",
      "fine.mp3",
    ].map(async (file) => {
      const audio = new URL(`../dist/client/audio/${file}`, import.meta.url);
      return (await stat(audio)).size;
    }),
  );

  assert.equal(sizes.length, 32);
  assert.ok(sizes.every((size) => size > 10_000));
});

test("defines the correct Đẳng exam ranges", async () => {
  const clientSource = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    clientSource,
    /id: "second-third-dang",[\s\S]{0,180}title: "2º–3º Đẳng",[\s\S]{0,180}max: 25/,
  );
  assert.match(
    clientSource,
    /id: "fourth-dang",[\s\S]{0,180}title: "4º Đẳng",[\s\S]{0,180}max: 30/,
  );
  assert.doesNotMatch(clientSource, /id: "third-dang"/);
});

test("packages the installable offline app assets", async () => {
  const manifestUrl = new URL(
    "../dist/client/manifest.webmanifest",
    import.meta.url,
  );
  const serviceWorkerUrl = new URL("../dist/client/sw.js", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const serviceWorker = await readFile(serviceWorkerUrl, "utf8");

  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, ".");
  assert.deepEqual(
    manifest.icons.map((icon) => icon.sizes),
    ["192x192", "512x512"],
  );

  assert.match(serviceWorker, /Array\.from\(\{ length: 30 \}/);
  assert.match(serviceWorker, /audio\/\$\{index \+ 1\}\.mp3/);
  assert.match(serviceWorker, /audio\/theme\.mp3/);
  assert.match(serviceWorker, /audio\/fine\.mp3/);
  assert.match(serviceWorker, /self\.registration\.scope/);

  const iconSizes = await Promise.all(
    [
      "../dist/client/icons/icon-192.png",
      "../dist/client/icons/icon-512.png",
      "../dist/client/apple-touch-icon.png",
      "../dist/client/images/logo-baolan.jpg",
      "../dist/client/images/logo-viet-vo-dao-italia.png",
      "../dist/client/og.png",
    ].map(async (path) => (await stat(new URL(path, import.meta.url))).size),
  );

  assert.ok(iconSizes.every((size) => size > 5_000));
});

test("includes precise voice, playback, and screen-awake support", async () => {
  const clientSource = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const styles = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const serviceWorker = await readFile(
    new URL("../dist/client/sw.js", import.meta.url),
    "utf8",
  );

  assert.match(clientSource, /createBufferSource/);
  assert.match(clientSource, /decodeAudioData/);
  assert.match(clientSource, /const WAKE_WORDS = \["prossimo"\]/);
  assert.match(clientSource, /spokenWords\.includes\(word\)/);
  assert.match(clientSource, /recognitionStartTimerRef/);
  assert.match(clientSource, /audioSession\.type = "play-and-record"/);
  assert.match(clientSource, /audioSession\.type = "playback"/);
  assert.match(clientSource, /audioSession\.type = "auto"/);
  assert.match(clientSource, /echoCancellation: false/);
  assert.match(clientSource, /window\.setTimeout\(resolve, 260\)/);
  assert.doesNotMatch(clientSource, /createMediaStreamSource/);
  assert.doesNotMatch(clientSource, /prossimo-detected/);
  assert.match(clientSource, /Attiva il microfono/);
  assert.match(clientSource, /gain\.gain\.value = 1\.7/);
  assert.match(clientSource, /new Audio\("audio\/theme\.mp3"\)/);
  assert.match(clientSource, /theme\.loop = true/);
  assert.match(clientSource, /theme\.volume = 0\.2/);
  assert.match(clientSource, /new Audio\("audio\/fine\.mp3"\)/);
  assert.match(clientSource, /void playCompletionSound\(\)/);
  assert.match(clientSource, /navigator\.wakeLock\.request\("screen"\)/);
  assert.match(clientSource, /visibilitychange/);
  assert.match(clientSource, /wakeLock\.release\(\)/);
  assert.match(clientSource, /Schermo mantenuto acceso/);
  assert.match(styles, /\.voice-core > \.voice-word/);
  assert.match(styles, /font-size: clamp\(8px, 2\.6vw, 14px\)/);
  assert.doesNotMatch(styles, /\.voice-core > span:not\(\.sound-bars\)/);
  assert.match(serviceWorker, /chien-luoc-trainer-v15/);
});

test("builds a GitHub Pages version with the project base path", async () => {
  const pagesHtml = await readFile(
    new URL("../out/index.html", import.meta.url),
    "utf8",
  );

  assert.match(pagesHtml, /\/chienluoc\/_next\//);
  assert.match(pagesHtml, /\/chienluoc\/manifest\.webmanifest/);
  assert.doesNotMatch(pagesHtml, /\/chienluoc\/chienluoc\/og\.png/);
  assert.ok(
    (await stat(new URL("../out/audio/30.mp3", import.meta.url))).size > 10_000,
  );
  assert.ok(
    (await stat(new URL("../out/audio/theme.mp3", import.meta.url))).size >
      10_000,
  );
  assert.ok(
    (await stat(new URL("../out/audio/fine.mp3", import.meta.url))).size >
      10_000,
  );
});
