import { readFile, writeFile } from "node:fs/promises";

const SHARE_ENDPOINT =
  "https://gateway-eu.umami.is/api/share/ol3UrBnUcB6U2QLp";
const API_BASE = "https://gateway-eu.umami.is/api";
const OUTPUT_URL = new URL("../public/stats.json", import.meta.url);
const PERIODS = [7, 30, 180];

const examNames = new Map([
  ["one-half", "1½ striscia"],
  ["two", "2 strisce"],
  ["three", "3 strisce"],
  ["four", "4 strisce"],
  ["black", "Cintura nera"],
  ["first-dang", "1º Đẳng"],
  ["second-third-dang", "2º–3º Đẳng"],
  ["fourth-dang", "4º Đẳng"],
]);

const deviceNames = {
  desktop: "Computer",
  laptop: "Computer",
  mobile: "Smartphone",
  tablet: "Tablet",
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`Umami ha risposto con ${response.status}`);
  }

  return response.json();
}

async function optional(promise, fallback) {
  try {
    return await promise;
  } catch (error) {
    console.warn(error instanceof Error ? error.message : String(error));
    return fallback;
  }
}

function aggregateDevices(values) {
  const totals = new Map();

  values.forEach((item) => {
    const label = deviceNames[item.x.toLowerCase()] ?? item.x;
    totals.set(label, (totals.get(label) ?? 0) + item.y);
  });

  return [...totals].map(([label, value]) => ({ label, value }));
}

async function loadPeriod(share, period) {
  const endAt = Date.now();
  const startAt = endAt - period * 24 * 60 * 60 * 1000;
  const headers = {
    "x-umami-share-token": share.token,
    "x-umami-share-context": "1",
  };
  const request = (path, params) =>
    fetchJson(
      `${API_BASE}/websites/${share.websiteId}${path}?${params.toString()}`,
      { headers },
    );
  const baseParams = () =>
    new URLSearchParams({ startAt: String(startAt), endAt: String(endAt) });
  const startParams = baseParams();
  startParams.set("event", "exam_start");
  const completeParams = baseParams();
  completeParams.set("event", "exam_complete");
  const seriesParams = baseParams();
  seriesParams.set("unit", period === 180 ? "month" : "day");
  seriesParams.set("timezone", "Europe/Rome");
  const examParams = baseParams();
  examParams.set("event", "exam_start");
  examParams.set("propertyName", "exam");
  const deviceParams = baseParams();
  deviceParams.set("type", "device");
  const osParams = baseParams();
  osParams.set("type", "os");

  const [overview, started, completed, eventSeries, examValues, devices, systems] =
    await Promise.all([
      optional(request("/stats", baseParams()), {}),
      optional(request("/events/stats", startParams), { data: {} }),
      optional(request("/events/stats", completeParams), { data: {} }),
      optional(request("/events/series", seriesParams), []),
      optional(request("/event-data/values", examParams), []),
      optional(request("/metrics", deviceParams), []),
      optional(request("/metrics", osParams), []),
    ]);

  const seriesByDate = new Map();
  eventSeries.forEach((point) => {
    if (point.x !== "exam_start" && point.x !== "exam_complete") return;
    const date = new Date(point.t);
    const key = date.toISOString();
    const current = seriesByDate.get(key) ?? {
      date,
      starts: 0,
      completed: 0,
    };
    if (point.x === "exam_start") current.starts += point.y;
    if (point.x === "exam_complete") current.completed += point.y;
    seriesByDate.set(key, current);
  });

  const series = [...seriesByDate.values()]
    .sort((left, right) => left.date.getTime() - right.date.getTime())
    .slice(period === 180 ? -6 : -10)
    .map((point) => ({
      label: new Intl.DateTimeFormat("it-IT", {
        day: period === 180 ? undefined : "numeric",
        month: "short",
      }).format(point.date),
      starts: point.starts,
      completed: point.completed,
    }));

  return {
    pageviews: overview.pageviews ?? 0,
    visitors: overview.visitors ?? 0,
    visits: overview.visits ?? 0,
    starts: started.data?.events ?? 0,
    completed: completed.data?.events ?? 0,
    exams: examValues
      .map((item) => ({
        label: examNames.get(item.value) ?? item.value,
        value: item.total,
      }))
      .sort((left, right) => right.value - left.value),
    devices: aggregateDevices(devices).sort(
      (left, right) => right.value - left.value,
    ),
    operatingSystems: systems
      .map((item) => ({ label: item.x, value: item.y }))
      .sort((left, right) => right.value - left.value),
    series,
  };
}

try {
  const share = await fetchJson(SHARE_ENDPOINT);
  const periods = {};

  for (const period of PERIODS) {
    periods[String(period)] = await loadPeriod(share, period);
  }

  await writeFile(
    OUTPUT_URL,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), periods }, null, 2)}\n`,
  );
  console.log("Statistiche Umami aggiornate.");
} catch (error) {
  try {
    await readFile(OUTPUT_URL, "utf8");
    console.warn("Umami non disponibile: mantengo l’ultima copia delle statistiche.");
    console.warn(error instanceof Error ? error.message : String(error));
  } catch {
    throw error;
  }
}
