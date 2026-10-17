"use client";

/* eslint-disable @next/next/no-img-element -- the local logo must remain directly cacheable offline */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Exam = {
  id: string;
  title: string;
  eyebrow: string;
  max: number;
  tone: "light" | "dark" | "red";
};

type AppScreen = "select" | "training" | "complete" | "stats";
type StatsPeriod = 7 | 30 | 180;

type StatsPoint = {
  label: string;
  starts: number;
  completed: number;
};

type StatsBreakdown = {
  label: string;
  value: number;
};

type StatsData = {
  visitors: number;
  visits: number;
  pageviews: number;
  starts: number;
  completed: number;
  exams: StatsBreakdown[];
  devices: StatsBreakdown[];
  operatingSystems: StatsBreakdown[];
  series: StatsPoint[];
  updatedAt: Date;
};

type StatsSnapshot = {
  generatedAt: string;
  periods: Record<string, Omit<StatsData, "updatedAt">>;
};

type TrainingStatus =
  | "idle"
  | "requesting"
  | "playing"
  | "listening"
  | "paused"
  | "unsupported"
  | "denied"
  | "error";

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionErrorEventLike = {
  error: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type AudioSessionType = "auto" | "playback" | "play-and-record";

type AudioSessionLike = {
  type: AudioSessionType;
};

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    webkitAudioContext?: typeof AudioContext;
  }

  interface Navigator {
    audioSession?: AudioSessionLike;
  }
}

const EXAMS: Exam[] = [
  {
    id: "one-half",
    title: "1½ striscia",
    eyebrow: "Cintura bianca",
    max: 6,
    tone: "light",
  },
  {
    id: "two",
    title: "2 strisce",
    eyebrow: "Cintura bianca",
    max: 9,
    tone: "light",
  },
  {
    id: "three",
    title: "3 strisce",
    eyebrow: "Cintura bianca",
    max: 12,
    tone: "light",
  },
  {
    id: "four",
    title: "4 strisce",
    eyebrow: "Cintura bianca",
    max: 15,
    tone: "light",
  },
  {
    id: "black",
    title: "Cintura nera",
    eyebrow: "Esame completo",
    max: 15,
    tone: "dark",
  },
  {
    id: "first-dang",
    title: "1º Đẳng",
    eyebrow: "Grado superiore",
    max: 20,
    tone: "red",
  },
  {
    id: "second-third-dang",
    title: "2º–3º Đẳng",
    eyebrow: "Grado superiore",
    max: 25,
    tone: "red",
  },
  {
    id: "fourth-dang",
    title: "4º Đẳng",
    eyebrow: "Grado superiore",
    max: 30,
    tone: "red",
  },
];

const WAKE_WORDS = ["prossimo"];

const UMAMI_SHARE_URL = "https://cloud.umami.is/share/ol3UrBnUcB6U2QLp";
const UMAMI_SHARE_ENDPOINT =
  "https://gateway-eu.umami.is/api/share/ol3UrBnUcB6U2QLp";
const UMAMI_API_BASE = "https://gateway-eu.umami.is/api";

const INTRO_STORAGE_KEY = "chien-luoc-intro-seen-v1";
const ANALYTICS_QUEUE_KEY = "chien-luoc-analytics-queue-v1";
const ANALYTICS_SESSION_KEY = "chien-luoc-analytics-session-v1";
const ANALYTICS_QUEUE_LIMIT = 50;
const UMAMI_WEBSITE_ID = "1ccb1211-a681-44e1-a8ef-5fc98a656dcf";
const UMAMI_COLLECT_ENDPOINT = "https://gateway.umami.is/api/send";
const APP_VERSION = "36";
const SERVICE_WORKER_RELOAD_KEY = "chien-luoc-sw-reloaded";
const AUDIO_ROUTE_SETTLE_MS = 420;

type PendingAnonymousEvent = {
  id: string;
  name?: string;
  data?: Record<string, string | number | boolean>;
  queuedAt: number;
};

let analyticsFlushPromise: Promise<void> | null = null;

function shuffle(max: number) {
  const values = Array.from({ length: max }, (_, index) => index + 1);

  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }

  return values;
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) return `${seconds} sec`;
  return `${minutes} min ${seconds.toString().padStart(2, "0")} sec`;
}

function prepareAudioSessionForMicrophone() {
  try {
    if (!navigator.audioSession) return false;
    navigator.audioSession.type = "play-and-record";
    return true;
  } catch {
    return false;
  }
}

function restoreAudioSessionForPlayback() {
  try {
    const audioSession = navigator.audioSession;
    if (!audioSession) return false;

    audioSession.type = "playback";
    return true;
  } catch {
    return false;
  }
}

function resetAudioSession() {
  try {
    if (navigator.audioSession) {
      navigator.audioSession.type = "auto";
    }
  } catch {
    // Some Safari versions expose the API without allowing every change.
  }
}

function setMediaElementVolume(audio: HTMLAudioElement, volume: number) {
  audio.volume = volume;
}

function readPendingAnonymousEvents(): PendingAnonymousEvent[] {
  try {
    const stored = window.localStorage.getItem(ANALYTICS_QUEUE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored) as PendingAnonymousEvent[];
    return Array.isArray(parsed) ? parsed.slice(-ANALYTICS_QUEUE_LIMIT) : [];
  } catch {
    return [];
  }
}

function writePendingAnonymousEvents(events: PendingAnonymousEvent[]) {
  try {
    if (events.length === 0) {
      window.localStorage.removeItem(ANALYTICS_QUEUE_KEY);
      return true;
    }

    window.localStorage.setItem(
      ANALYTICS_QUEUE_KEY,
      JSON.stringify(events.slice(-ANALYTICS_QUEUE_LIMIT)),
    );
    return true;
  } catch {
    return false;
  }
}

function createAnonymousEventId() {
  try {
    return window.crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

async function sendPendingAnonymousEvent(event: PendingAnonymousEvent) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-umami-website-id": UMAMI_WEBSITE_ID,
      "x-umami-hostname": window.location.hostname,
    };

    try {
      const sessionCache = window.sessionStorage.getItem(ANALYTICS_SESSION_KEY);
      if (sessionCache) headers["x-umami-cache"] = sessionCache;
    } catch {
      // Umami crea comunque una sessione se sessionStorage non è disponibile.
    }

    const response = await fetch(UMAMI_COLLECT_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      keepalive: true,
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        type: "event",
        payload: {
          website: UMAMI_WEBSITE_ID,
          hostname: window.location.hostname,
          screen: `${window.screen.width}x${window.screen.height}`,
          language: window.navigator.language,
          title: document.title,
          url: `${window.location.pathname}${window.location.search}`,
          referrer: document.referrer,
          timestamp: Math.floor(event.queuedAt / 1000),
          ...(event.name ? { name: event.name } : {}),
          ...(event.data ? { data: event.data } : {}),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Umami ha risposto con ${response.status}`);
    }

    const result = (await response.json().catch(() => null)) as
      | { cache?: string }
      | null;
    if (result?.cache) {
      try {
        window.sessionStorage.setItem(ANALYTICS_SESSION_KEY, result.cache);
      } catch {
        // La ricezione è confermata anche se il token non può essere salvato.
      }
    }
  } finally {
    window.clearTimeout(timeout);
  }
}

async function flushPendingAnonymousEvents() {
  if (analyticsFlushPromise) return analyticsFlushPromise;
  if (!navigator.onLine) return;

  analyticsFlushPromise = (async () => {
    const pending = readPendingAnonymousEvents();

    for (const event of pending) {
      if (!navigator.onLine) break;

      try {
        await sendPendingAnonymousEvent(event);
        const remaining = readPendingAnonymousEvents().filter(
          (queuedEvent) => queuedEvent.id !== event.id,
        );
        writePendingAnonymousEvents(remaining);
      } catch {
        break;
      }
    }
  })().finally(() => {
    analyticsFlushPromise = null;
  });

  return analyticsFlushPromise;
}

function queueAnonymousEvent(
  name?: string,
  data?: Record<string, string | number | boolean>,
) {
  const event: PendingAnonymousEvent = {
    id: createAnonymousEventId(),
    name,
    data,
    queuedAt: Date.now(),
  };

  const pending = [...readPendingAnonymousEvents(), event].slice(
    -ANALYTICS_QUEUE_LIMIT,
  );

  if (!writePendingAnonymousEvents(pending)) return;
  void flushPendingAnonymousEvents();
}

function trackAnonymousEvent(
  eventName: string,
  eventData?: Record<string, string | number | boolean>,
) {
  queueAnonymousEvent(eventName, eventData);
}

function formatStatsNumber(value: number) {
  return new Intl.NumberFormat("it-IT").format(value);
}

function StatsDashboard({ onBack }: { onBack: () => void }) {
  const [period, setPeriod] = useState<StatsPeriod>(30);
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    const loadStats = async () => {
      setLoading(true);
      setError("");

      try {
        const snapshotResponse = await fetch(
          `stats.json?period=${period}&v=${APP_VERSION}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (snapshotResponse.ok) {
          const snapshot = (await snapshotResponse.json()) as StatsSnapshot;
          const snapshotData = snapshot.periods[String(period)];
          if (snapshotData) {
            setData({
              ...snapshotData,
              updatedAt: new Date(snapshot.generatedAt),
            });
            return;
          }
        }

        const shareResponse = await fetch(UMAMI_SHARE_ENDPOINT, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!shareResponse.ok) throw new Error("Condivisione non disponibile");

        const share = (await shareResponse.json()) as {
          websiteId: string;
          token: string;
        };
        const endAt = Date.now();
        const startAt = endAt - period * 24 * 60 * 60 * 1000;
        const timezone =
          Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Rome";
        const headers = {
          "x-umami-share-token": share.token,
          "x-umami-share-context": "1",
        };

        const request = async <T,>(path: string, params: URLSearchParams) => {
          const response = await fetch(
            `${UMAMI_API_BASE}/websites/${share.websiteId}${path}?${params}`,
            { cache: "no-store", headers, signal: controller.signal },
          );
          if (!response.ok) throw new Error("Statistiche non disponibili");
          return (await response.json()) as T;
        };

        const baseParams = () =>
          new URLSearchParams({
            startAt: String(startAt),
            endAt: String(endAt),
          });
        const startParams = baseParams();
        startParams.set("event", "exam_start");
        const completeParams = baseParams();
        completeParams.set("event", "exam_complete");
        const seriesParams = baseParams();
        seriesParams.set("unit", period === 180 ? "month" : "day");
        seriesParams.set("timezone", timezone);
        const examParams = baseParams();
        examParams.set("event", "exam_start");
        examParams.set("propertyName", "exam");
        const deviceParams = baseParams();
        deviceParams.set("type", "device");
        const osParams = baseParams();
        osParams.set("type", "os");

        const [
          overview,
          started,
          completed,
          eventSeries,
          examValues,
          deviceValues,
          osValues,
        ] = await Promise.all([
          request<{
            pageviews: number;
            visitors: number;
            visits: number;
          }>("/stats", baseParams()),
          request<{ data: { events: number } }>("/events/stats", startParams),
          request<{ data: { events: number } }>(
            "/events/stats",
            completeParams,
          ),
          request<Array<{ x: string; t: string; y: number }>>(
            "/events/series",
            seriesParams,
          ),
          request<Array<{ value: string; total: number }>>(
            "/event-data/values",
            examParams,
          ),
          request<Array<{ x: string; y: number }>>("/metrics", deviceParams),
          request<Array<{ x: string; y: number }>>("/metrics", osParams),
        ]);

        const examNames = new Map(EXAMS.map((exam) => [exam.id, exam.title]));
        const deviceNames: Record<string, string> = {
          desktop: "Computer",
          laptop: "Computer",
          mobile: "Smartphone",
          tablet: "Tablet",
        };
        const seriesByDate = new Map<
          string,
          { date: Date; starts: number; completed: number }
        >();

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

        setData({
          pageviews: overview.pageviews ?? 0,
          visitors: overview.visitors ?? 0,
          visits: overview.visits ?? 0,
          starts: started.data.events ?? 0,
          completed: completed.data.events ?? 0,
          exams: examValues
            .map((item) => ({
              label: examNames.get(item.value) ?? item.value,
              value: item.total,
            }))
            .sort((left, right) => right.value - left.value),
          devices: deviceValues
            .map((item) => ({
              label: deviceNames[item.x.toLowerCase()] ?? item.x,
              value: item.y,
            }))
            .sort((left, right) => right.value - left.value),
          operatingSystems: osValues
            .map((item) => ({ label: item.x, value: item.y }))
            .sort((left, right) => right.value - left.value),
          series,
          updatedAt: new Date(),
        });
      } catch (statsError) {
        if ((statsError as Error).name !== "AbortError") {
          setError(
            navigator.onLine
              ? "Non riesco a caricare le statistiche in questo momento."
              : "Connettiti a Internet per visualizzare le statistiche.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadStats();
    return () => controller.abort();
  }, [period, reloadKey]);

  const completionRate = data?.starts
    ? Math.min(100, Math.round((data.completed / data.starts) * 100))
    : 0;
  const chartMaximum = Math.max(
    1,
    ...(data?.series.flatMap((point) => [point.starts, point.completed]) ?? []),
  );
  const examMaximum = Math.max(1, ...(data?.exams.map((item) => item.value) ?? []));

  return (
    <main className="app-shell stats-shell">
      <div className="grain" aria-hidden="true" />
      <header className="stats-header">
        <button className="stats-back" onClick={onBack} aria-label="Torna agli esami">
          ←
        </button>
        <div>
          <span>Chiến lược Trainer</span>
          <strong>Statistiche</strong>
        </div>
        <span className="stats-privacy">
          <i aria-hidden="true" /> Dati anonimi
        </span>
      </header>

      <section className="stats-content">
        <div className="stats-intro">
          <div>
            <p className="overline">Utilizzo dell’app</p>
            <h1>Come viene usato l’allenamento.</h1>
          </div>
          <a href={UMAMI_SHARE_URL} target="_blank" rel="noreferrer">
            Apri dettagli Umami ↗
          </a>
        </div>

        <div className="stats-periods" aria-label="Intervallo temporale">
          {([7, 30, 180] as StatsPeriod[]).map((days) => (
            <button
              key={days}
              className={period === days ? "is-active" : undefined}
              onClick={() => setPeriod(days)}
              aria-pressed={period === days}
            >
              {days === 180 ? "6 mesi" : `${days} giorni`}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="stats-message" role="status">
            <span className="stats-loader" aria-hidden="true" />
            Caricamento delle statistiche…
          </div>
        ) : error ? (
          <div className="stats-message stats-error" role="alert">
            <strong>{error}</strong>
            <button onClick={() => setReloadKey((value) => value + 1)}>
              Riprova
            </button>
          </div>
        ) : data ? (
          <>
            <section className="stats-kpis" aria-label="Dati principali">
              <article>
                <span>Utenti</span>
                <strong>{formatStatsNumber(data.visitors)}</strong>
                <small>visitatori stimati</small>
              </article>
              <article>
                <span>Visite</span>
                <strong>{formatStatsNumber(data.visits)}</strong>
                <small>{formatStatsNumber(data.pageviews)} aperture</small>
              </article>
              <article>
                <span>Avviate</span>
                <strong>{formatStatsNumber(data.starts)}</strong>
                <small>interrogazioni</small>
              </article>
              <article className="stats-kpi-highlight">
                <span>Completate</span>
                <strong>{formatStatsNumber(data.completed)}</strong>
                <small>sessioni concluse</small>
              </article>
            </section>

            <div className="stats-grid">
              <section className="stats-panel stats-trend" aria-labelledby="trend-title">
                <div className="stats-panel-heading">
                  <h2 id="trend-title">Andamento</h2>
                  <span>{period === 180 ? "ultimi 6 mesi" : `ultimi ${period} giorni`}</span>
                </div>
                {data.series.length ? (
                  <>
                    <div className="stats-chart" aria-label="Interrogazioni avviate e completate">
                      {data.series.map((point) => (
                        <div className="stats-chart-group" key={point.label}>
                          <div className="stats-chart-bars">
                            <i
                              className="stats-bar-start"
                              style={{ height: `${Math.max(4, (point.starts / chartMaximum) * 100)}%` }}
                              title={`${point.starts} avviate`}
                            />
                            <i
                              className="stats-bar-complete"
                              style={{ height: `${Math.max(point.completed ? 4 : 0, (point.completed / chartMaximum) * 100)}%` }}
                              title={`${point.completed} completate`}
                            />
                          </div>
                          <span>{point.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="stats-legend">
                      <span><i /> Avviate</span>
                      <span><i className="complete" /> Completate</span>
                    </div>
                  </>
                ) : (
                  <p className="stats-empty">I primi dati appariranno dopo l’avvio di un’interrogazione.</p>
                )}
              </section>

              <section className="stats-panel stats-completion" aria-labelledby="completion-title">
                <div className="stats-panel-heading">
                  <h2 id="completion-title">Completamento</h2>
                </div>
                <strong>{completionRate}%</strong>
                <span>arriva alla fine</span>
                <div
                  className="stats-progress"
                  role="progressbar"
                  aria-label="Tasso di completamento"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={completionRate}
                >
                  <i style={{ width: `${completionRate}%` }} />
                </div>
                <div className="stats-progress-labels">
                  <span>{formatStatsNumber(data.starts)} avviate</span>
                  <span>{formatStatsNumber(data.completed)} completate</span>
                </div>
              </section>

              <section className="stats-panel stats-ranking" aria-labelledby="ranking-title">
                <div className="stats-panel-heading">
                  <h2 id="ranking-title">Esami più utilizzati</h2>
                  <span>interrogazioni avviate</span>
                </div>
                {data.exams.length ? (
                  <div className="stats-rank-list">
                    {data.exams.map((exam) => (
                      <div className="stats-rank-row" key={exam.label}>
                        <span>{exam.label}</span>
                        <div><i style={{ width: `${(exam.value / examMaximum) * 100}%` }} /></div>
                        <strong>{formatStatsNumber(exam.value)}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="stats-empty">Nessun esame avviato nel periodo selezionato.</p>
                )}
              </section>

              <section className="stats-panel stats-devices" aria-labelledby="devices-title">
                <div className="stats-panel-heading">
                  <h2 id="devices-title">Dispositivi</h2>
                </div>
                <div className="stats-breakdowns">
                  {[...data.devices, ...data.operatingSystems].slice(0, 6).map((item) => (
                    <div key={`${item.label}-${item.value}`}>
                      <span>{item.label}</span>
                      <strong>{formatStatsNumber(item.value)}</strong>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <p className="stats-updated">
              Aggiornato alle {data.updatedAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}

export default function Home() {
  const [screen, setScreen] = useState<AppScreen>("select");
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [queue, setQueue] = useState<number[]>([]);
  const [position, setPosition] = useState(0);
  const [status, setStatus] = useState<TrainingStatus>("idle");
  const [heard, setHeard] = useState("");
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showIntro, setShowIntro] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [offlineReady, setOfflineReady] = useState(false);
  const [screenAwake, setScreenAwake] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const themeAudioRef = useRef<HTMLAudioElement | null>(null);
  const themeAudioContextRef = useRef<AudioContext | null>(null);
  const themeAudioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const themeGainRef = useRef<GainNode | null>(null);
  const selectionGongRef = useRef<HTMLAudioElement | null>(null);
  const selectionGongTimerRef = useRef<number | null>(null);
  const examSelectionInProgressRef = useRef(false);
  const completionAudioRef = useRef<HTMLAudioElement | null>(null);
  const completionSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const completionAudioTokenRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackGainRef = useRef<GainNode | null>(null);
  const audioBufferCacheRef = useRef<Map<number | "fine", AudioBuffer>>(
    new Map(),
  );
  const playbackTokenRef = useRef(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recognitionActiveRef = useRef(false);
  const recognitionStartTimerRef = useRef<number | null>(null);
  const shouldListenRef = useRef(false);
  const transitionRef = useRef(false);
  const pausedRef = useRef(false);
  const queueRef = useRef<number[]>([]);
  const positionRef = useRef(0);
  const screenRef = useRef<AppScreen>("select");
  const reloadWhenSafeRef = useRef(false);
  const advanceRef = useRef<() => void>(() => undefined);
  const startedAtRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const wakeLockRequestRef = useRef(false);
  const shouldKeepScreenAwakeRef = useRef(false);

  const currentNumber = queue[position];
  const completedNumbers = useMemo(
    () => queue.slice(0, position),
    [position, queue],
  );

  const releaseScreenWakeLock = useCallback(() => {
    const wakeLock = wakeLockRef.current;
    wakeLockRef.current = null;
    setScreenAwake(false);

    if (wakeLock && !wakeLock.released) {
      void wakeLock.release().catch(() => undefined);
    }
  }, []);

  const requestScreenWakeLock = useCallback(async () => {
    if (
      !("wakeLock" in navigator) ||
      document.visibilityState !== "visible" ||
      wakeLockRequestRef.current ||
      (wakeLockRef.current && !wakeLockRef.current.released)
    ) {
      return;
    }

    wakeLockRequestRef.current = true;

    try {
      const wakeLock = await navigator.wakeLock.request("screen");

      if (
        !shouldKeepScreenAwakeRef.current ||
        pausedRef.current ||
        document.visibilityState !== "visible"
      ) {
        void wakeLock.release().catch(() => undefined);
        return;
      }

      wakeLockRef.current = wakeLock;
      setScreenAwake(true);
      wakeLock.addEventListener(
        "release",
        () => {
          if (wakeLockRef.current === wakeLock) {
            wakeLockRef.current = null;
            setScreenAwake(false);
          }
        },
        { once: true },
      );
    } catch {
      setScreenAwake(false);
    } finally {
      wakeLockRequestRef.current = false;
    }
  }, []);

  const pauseThemeMusic = useCallback(() => {
    themeAudioRef.current?.pause();
    const context = themeAudioContextRef.current;
    if (context && context.state === "running") {
      void context.suspend().catch(() => undefined);
    }
  }, []);

  const stopThemeMusic = useCallback(() => {
    const theme = themeAudioRef.current;
    if (theme) {
      pauseThemeMusic();
      theme.currentTime = 0;
      theme.src = "";
      themeAudioRef.current = null;
    }

    themeAudioSourceRef.current?.disconnect();
    themeAudioSourceRef.current = null;
    themeGainRef.current?.disconnect();
    themeGainRef.current = null;

    const context = themeAudioContextRef.current;
    themeAudioContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close();
    }
  }, [pauseThemeMusic]);

  const startThemeMusic = useCallback(async () => {
    if (document.visibilityState !== "visible") return;

    let theme = themeAudioRef.current;

    if (!theme) {
      theme = new Audio("audio/theme.mp3?v=22");
      theme.preload = "auto";
      theme.loop = true;
      themeAudioRef.current = theme;
    }

    if (!themeAudioContextRef.current) {
      const AudioContextConstructor =
        window.AudioContext ?? window.webkitAudioContext;

      if (AudioContextConstructor) {
        try {
          const context = new AudioContextConstructor();
          const source = context.createMediaElementSource(theme);
          const themeGain = context.createGain();
          themeGain.gain.value = 0.1;
          source.connect(themeGain);
          themeGain.connect(context.destination);
          themeAudioContextRef.current = context;
          themeAudioSourceRef.current = source;
          themeGainRef.current = themeGain;
          setMediaElementVolume(theme, 1);
        } catch {
          setMediaElementVolume(theme, 0.1);
        }
      } else {
        setMediaElementVolume(theme, 0.1);
      }
    }

    const context = themeAudioContextRef.current;
    if (context?.state === "suspended") {
      await context.resume().catch(() => undefined);
    }

    if (!theme.paused) return;
    await theme.play().catch(() => undefined);
    if (document.visibilityState !== "visible") {
      theme.pause();
    }
  }, []);

  const stopCompletionSound = useCallback(() => {
    completionAudioTokenRef.current += 1;

    const source = completionSourceRef.current;
    completionSourceRef.current = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // The completion sound may already have finished.
      }
      source.disconnect();
    }

    const completion = completionAudioRef.current;
    completionAudioRef.current = null;

    if (!completion) return;
    completion.onended = null;
    completion.pause();
    completion.src = "";
  }, []);

  const stopSelectionGong = useCallback(() => {
    if (selectionGongTimerRef.current !== null) {
      window.clearTimeout(selectionGongTimerRef.current);
      selectionGongTimerRef.current = null;
    }

    const gong = selectionGongRef.current;
    selectionGongRef.current = null;
    if (!gong) return;

    gong.onended = null;
    gong.onerror = null;
    gong.pause();
    gong.src = "";
  }, []);

  const playSelectionGong = useCallback(async () => {
    stopSelectionGong();

    await new Promise<void>((resolve) => {
      const gong = new Audio("audio/gong.mp3?v=30");
      gong.preload = "auto";
      selectionGongRef.current = gong;
      let finished = false;

      const finish = () => {
        if (finished) return;
        finished = true;
        if (selectionGongTimerRef.current !== null) {
          window.clearTimeout(selectionGongTimerRef.current);
          selectionGongTimerRef.current = null;
        }
        gong.onended = null;
        gong.onerror = null;
        if (selectionGongRef.current === gong) {
          selectionGongRef.current = null;
        }
        resolve();
      };

      gong.onended = finish;
      gong.onerror = finish;
      selectionGongTimerRef.current = window.setTimeout(finish, 2500);
      void gong.play().catch(finish);
    });
  }, [stopSelectionGong]);

  const stopPlayback = useCallback(() => {
    playbackTokenRef.current += 1;

    const source = playbackSourceRef.current;
    playbackSourceRef.current = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // The source may already have finished naturally.
      }
      source.disconnect();
    }

    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.pause();
      audio.src = "";
    }
  }, []);

  const releaseAudioEngine = useCallback(() => {
    shouldKeepScreenAwakeRef.current = false;
    releaseScreenWakeLock();
    resetAudioSession();
    stopPlayback();
    audioBufferCacheRef.current.clear();
    playbackGainRef.current?.disconnect();
    playbackGainRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close();
    }
  }, [releaseScreenWakeLock, stopPlayback]);

  const ensureAudioContext = useCallback(async () => {
    const AudioContextConstructor =
      window.AudioContext ?? window.webkitAudioContext;

    if (!AudioContextConstructor) return null;

    let context = audioContextRef.current;
    if (!context || context.state === "closed") {
      context = new AudioContextConstructor();
      audioContextRef.current = context;
    }

    if (context.state === "suspended") {
      await context.resume();
    }

    return context;
  }, []);

  const playCompletionSound = useCallback(async () => {
    stopCompletionSound();
    const completionToken = completionAudioTokenRef.current;
    const audioRouteWasReset = restoreAudioSessionForPlayback();

    if (audioRouteWasReset) {
      await new Promise((resolve) =>
        window.setTimeout(resolve, AUDIO_ROUTE_SETTLE_MS),
      );
    }
    if (completionToken !== completionAudioTokenRef.current) return;

    const context = await ensureAudioContext().catch(() => null);
    if (context && context.state !== "closed") {
      try {
        let completionBuffer = audioBufferCacheRef.current.get("fine");
        if (!completionBuffer) {
          const response = await fetch("audio/fine.mp3?v=22", {
            cache: "force-cache",
          });
          if (!response.ok) {
            throw new Error("Audio finale non disponibile");
          }
          completionBuffer = await context.decodeAudioData(
            await response.arrayBuffer(),
          );
          audioBufferCacheRef.current.set("fine", completionBuffer);
        }

        if (completionToken !== completionAudioTokenRef.current) return;

        const source = context.createBufferSource();
        source.buffer = completionBuffer;
        source.connect(context.destination);
        completionSourceRef.current = source;
        source.onended = () => {
          if (completionAudioTokenRef.current !== completionToken) return;
          completionSourceRef.current = null;
          source.disconnect();
          releaseAudioEngine();
        };
        source.start(0);
        return;
      } catch {
        if (completionToken !== completionAudioTokenRef.current) return;
      }
    }

    const completion = new Audio("audio/fine.mp3?v=22");
    completion.preload = "auto";
    completion.volume = 1;
    completionAudioRef.current = completion;
    completion.onended = () => {
      if (completionAudioRef.current === completion) {
        completionAudioRef.current = null;
      }
      releaseAudioEngine();
    };
    completion.onerror = () => releaseAudioEngine();

    await completion.play().catch(() => releaseAudioEngine());
  }, [
    ensureAudioContext,
    releaseAudioEngine,
    stopCompletionSound,
  ]);

  const stopRecognition = useCallback(() => {
    shouldListenRef.current = false;

    if (recognitionStartTimerRef.current !== null) {
      window.clearTimeout(recognitionStartTimerRef.current);
      recognitionStartTimerRef.current = null;
    }

    if (recognitionRef.current && recognitionActiveRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Some browsers throw when recognition has already stopped.
      }
    }

    restoreAudioSessionForPlayback();
  }, []);

  const beginListening = useCallback(() => {
    if (pausedRef.current) return;

    const recognition = recognitionRef.current;

    if (!recognition) {
      shouldListenRef.current = false;
      setStatus("unsupported");
      return;
    }

    shouldListenRef.current = true;
    setHeard("");

    if (recognitionActiveRef.current) {
      setStatus("listening");
      return;
    }

    try {
      prepareAudioSessionForMicrophone();
      recognition.start();
      recognitionStartTimerRef.current = window.setTimeout(() => {
        if (!recognitionActiveRef.current && shouldListenRef.current) {
          shouldListenRef.current = false;
          setStatus("unsupported");
          try {
            recognition.abort();
          } catch {
            // The recognizer may never have started.
          }
        }
      }, 4500);
    } catch {
      window.setTimeout(() => {
        if (!shouldListenRef.current || pausedRef.current) return;
        try {
          recognition.start();
        } catch {
          setStatus("error");
        }
      }, 350);
    }
  }, []);

  const playPrompt = useCallback(
    async (number: number) => {
      stopRecognition();
      stopPlayback();
      const playbackToken = playbackTokenRef.current;
      transitionRef.current = false;
      setHeard("");
      setStatus("playing");

      const audioRouteWasReset = restoreAudioSessionForPlayback();
      if (audioRouteWasReset) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, AUDIO_ROUTE_SETTLE_MS),
        );
        if (playbackToken !== playbackTokenRef.current || pausedRef.current) {
          return;
        }
      }

      const context = audioContextRef.current;
      if (context && context.state !== "closed") {
        try {
          if (!playbackGainRef.current) {
            const gain = context.createGain();
            gain.gain.value = 1;
            gain.connect(context.destination);
            playbackGainRef.current = gain;
          }

          if (context.state === "suspended") {
            await context.resume();
          }

          let audioBuffer = audioBufferCacheRef.current.get(number);
          if (!audioBuffer) {
            const response = await fetch(`audio/${number}.mp3?v=22`, {
              cache: "force-cache",
            });
            if (!response.ok) {
              throw new Error(`Audio ${number} non disponibile`);
            }
            audioBuffer = await context.decodeAudioData(
              await response.arrayBuffer(),
            );
            audioBufferCacheRef.current.set(number, audioBuffer);
          }

          if (
            playbackToken !== playbackTokenRef.current ||
            pausedRef.current
          ) {
            return;
          }

          const source = context.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(playbackGainRef.current);
          playbackSourceRef.current = source;
          source.onended = () => {
            if (playbackToken !== playbackTokenRef.current) return;
            playbackSourceRef.current = null;
            source.disconnect();

            if (pausedRef.current) {
              setStatus("paused");
              return;
            }
            beginListening();
          };
          source.start(0);
          return;
        } catch {
          if (playbackToken !== playbackTokenRef.current) return;
        }
      }

      const audio = new Audio(`audio/${number}.mp3?v=22`);
      audio.preload = "auto";
      audio.volume = 1;
      audioRef.current = audio;

      audio.onended = () => {
        if (playbackToken !== playbackTokenRef.current) return;
        if (pausedRef.current) {
          setStatus("paused");
          return;
        }
        beginListening();
      };

      audio.onerror = () => {
        setStatus("error");
      };

      void audio.play().catch(() => {
        setStatus("error");
      });
    },
    [beginListening, stopPlayback, stopRecognition],
  );

  const advance = useCallback(() => {
    if (transitionRef.current || screen !== "training") return;

    transitionRef.current = true;
    stopRecognition();
    stopPlayback();

    const nextPosition = positionRef.current + 1;
    const activeQueue = queueRef.current;

    if (nextPosition >= activeQueue.length) {
      const seconds = Math.max(
        1,
        Math.round((window.performance.now() - startedAtRef.current) / 1000),
      );
      if (selectedExam) {
        trackAnonymousEvent("exam_complete", { exam: selectedExam.id });
      }
      setElapsedSeconds(seconds);
      setStatus("idle");
      setScreen("complete");
      shouldKeepScreenAwakeRef.current = false;
      releaseScreenWakeLock();
      void playCompletionSound();
      return;
    }

    positionRef.current = nextPosition;
    setPosition(nextPosition);
    window.setTimeout(() => void playPrompt(activeQueue[nextPosition]), 180);
  }, [
    playPrompt,
    playCompletionSound,
    releaseScreenWakeLock,
    screen,
    selectedExam,
    stopPlayback,
    stopRecognition,
  ]);

  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  useEffect(() => {
    screenRef.current = screen;

    if (screen !== "training" && reloadWhenSafeRef.current) {
      reloadWhenSafeRef.current = false;
      window.sessionStorage.setItem(SERVICE_WORKER_RELOAD_KEY, APP_VERSION);
      window.location.reload();
    }
  }, [screen]);

  useEffect(() => {
    let shouldShowIntro = false;
    try {
      shouldShowIntro = !window.localStorage.getItem(INTRO_STORAGE_KEY);
    } catch {
      shouldShowIntro = true;
    }
    const introTimer = window.setTimeout(
      () => setShowIntro(shouldShowIntro),
      0,
    );

    const tryFlushAnalytics = () => {
      void flushPendingAnonymousEvents();
    };
    const handleVisibilityForAnalytics = () => {
      if (document.visibilityState === "visible") tryFlushAnalytics();
    };
    const updateConnection = () => {
      setIsOnline(navigator.onLine);
      if (navigator.onLine && document.readyState === "complete") {
        tryFlushAnalytics();
      }
    };
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    window.addEventListener("pageshow", tryFlushAnalytics);
    document.addEventListener("visibilitychange", handleVisibilityForAnalytics);

    const analyticsRetryTimer = window.setInterval(
      tryFlushAnalytics,
      15_000,
    );
    queueAnonymousEvent();

    const handleControllerChange = () => {
      if (
        window.sessionStorage.getItem(SERVICE_WORKER_RELOAD_KEY) === APP_VERSION
      ) {
        return;
      }

      if (screenRef.current === "training") {
        reloadWhenSafeRef.current = true;
        return;
      }

      window.sessionStorage.setItem(SERVICE_WORKER_RELOAD_KEY, APP_VERSION);
      window.location.reload();
    };

    navigator.serviceWorker?.addEventListener(
      "controllerchange",
      handleControllerChange,
    );

    if (
      "serviceWorker" in navigator &&
      process.env.NODE_ENV === "production"
    ) {
      void navigator.serviceWorker
        .register(`sw.js?v=${APP_VERSION}`)
        .then(async (registration) => {
          await registration.update();
          return navigator.serviceWorker.ready;
        })
        .then(() => setOfflineReady(true))
        .catch(() => setOfflineReady(false));
    }

    return () => {
      window.clearTimeout(introTimer);
      window.clearInterval(analyticsRetryTimer);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      window.removeEventListener("pageshow", tryFlushAnalytics);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityForAnalytics,
      );
      navigator.serviceWorker?.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        shouldKeepScreenAwakeRef.current &&
        !pausedRef.current
      ) {
        void requestScreenWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [requestScreenWakeLock]);

  useEffect(() => {
    const Recognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.lang = "it-IT";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      prepareAudioSessionForMicrophone();
      if (recognitionStartTimerRef.current !== null) {
        window.clearTimeout(recognitionStartTimerRef.current);
        recognitionStartTimerRef.current = null;
      }
      recognitionActiveRef.current = true;
      if (shouldListenRef.current && !pausedRef.current) {
        setStatus("listening");
      }
    };

    recognition.onresult = (event) => {
      const alternatives: string[] = [];

      for (
        let resultIndex = event.resultIndex;
        resultIndex < event.results.length;
        resultIndex += 1
      ) {
        const result = event.results[resultIndex];
        for (
          let alternativeIndex = 0;
          alternativeIndex < result.length;
          alternativeIndex += 1
        ) {
          alternatives.push(
            result[alternativeIndex].transcript.toLocaleLowerCase("it"),
          );
        }
      }

      const transcript = alternatives[0]?.trim() ?? "";
      setHeard(transcript);

      const detected = alternatives.some((candidate) => {
        const spokenWords = candidate
          .replace(/[.,!?;:]/g, " ")
          .split(/\s+/)
          .filter(Boolean);

        return WAKE_WORDS.some((word) => spokenWords.includes(word));
      });

      if (detected) {
        shouldListenRef.current = false;
        advanceRef.current();
      }
    };

    recognition.onerror = (event) => {
      if (recognitionStartTimerRef.current !== null) {
        window.clearTimeout(recognitionStartTimerRef.current);
        recognitionStartTimerRef.current = null;
      }
      recognitionActiveRef.current = false;

      if (
        event.error === "service-not-allowed" ||
        event.error === "network" ||
        event.error === "language-not-supported"
      ) {
        shouldListenRef.current = false;
        restoreAudioSessionForPlayback();
        setStatus("unsupported");
        return;
      }

      if (event.error === "not-allowed" || event.error === "audio-capture") {
        shouldListenRef.current = false;
        restoreAudioSessionForPlayback();
        setStatus(event.error === "not-allowed" ? "denied" : "error");
      }
    };

    recognition.onend = () => {
      recognitionActiveRef.current = false;

      if (
        !shouldListenRef.current ||
        pausedRef.current
      ) {
        restoreAudioSessionForPlayback();
        return;
      }

      window.setTimeout(() => {
        if (!shouldListenRef.current || pausedRef.current) return;
        try {
          prepareAudioSessionForMicrophone();
          recognition.start();
        } catch {
          // The next onend cycle will try again.
        }
      }, 300);
    };

    recognitionRef.current = recognition;

    return () => {
      shouldListenRef.current = false;
      try {
        recognition.abort();
      } catch {
        // Recognition may already be inactive.
      }
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (screen === "select") {
      void startThemeMusic();
      return;
    }

    stopThemeMusic();
  }, [screen, startThemeMusic, stopThemeMusic]);

  useEffect(() => {
    const syncThemeWithPage = () => {
      if (document.visibilityState !== "visible") {
        pauseThemeMusic();
        return;
      }

      if (screen === "select") {
        void startThemeMusic();
      }
    };

    document.addEventListener("visibilitychange", syncThemeWithPage);
    window.addEventListener("pagehide", pauseThemeMusic);
    window.addEventListener("pageshow", syncThemeWithPage);

    return () => {
      document.removeEventListener("visibilitychange", syncThemeWithPage);
      window.removeEventListener("pagehide", pauseThemeMusic);
      window.removeEventListener("pageshow", syncThemeWithPage);
    };
  }, [pauseThemeMusic, screen, startThemeMusic]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      stopThemeMusic();
      stopSelectionGong();
      stopCompletionSound();
      releaseAudioEngine();
    };
  }, [
    releaseAudioEngine,
    stopCompletionSound,
    stopSelectionGong,
    stopThemeMusic,
  ]);

  const requestMicrophone = async () => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      !recognitionRef.current
    ) {
      return "unsupported" as const;
    }

    try {
      await ensureAudioContext();

      prepareAudioSessionForMicrophone();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });
      stream.getTracks().forEach((track) => track.stop());
      restoreAudioSessionForPlayback();
      await new Promise((resolve) =>
        window.setTimeout(resolve, AUDIO_ROUTE_SETTLE_MS),
      );

      return "ready" as const;
    } catch {
      restoreAudioSessionForPlayback();
      return "denied" as const;
    }
  };

  const startExam = async (exam: Exam) => {
    stopThemeMusic();
    stopCompletionSound();
    const audioContextReady = ensureAudioContext();
    const newQueue = shuffle(exam.max);
    setSelectedExam(exam);
    setQueue(newQueue);
    queueRef.current = newQueue;
    setPosition(0);
    positionRef.current = 0;
    setHeard("");
    setIsPaused(false);
    pausedRef.current = false;
    transitionRef.current = false;
    setScreen("training");
    setStatus("requesting");
    startedAtRef.current = window.performance.now();
    shouldKeepScreenAwakeRef.current = true;
    void requestScreenWakeLock();
    trackAnonymousEvent("exam_start", { exam: exam.id });

    await audioContextReady.catch(() => null);
    const microphone = await requestMicrophone();
    if (microphone === "denied") setStatus("denied");
    if (microphone === "unsupported") setStatus("unsupported");

    void playPrompt(newQueue[0]);
  };

  const selectExam = async (exam: Exam) => {
    if (examSelectionInProgressRef.current) return;
    examSelectionInProgressRef.current = true;
    stopThemeMusic();

    try {
      await playSelectionGong();
      await startExam(exam);
    } finally {
      examSelectionInProgressRef.current = false;
    }
  };

  const retryMicrophone = async () => {
    setStatus("requesting");
    const microphone = await requestMicrophone();

    if (microphone === "ready") {
      beginListening();
      return;
    }

    setStatus(microphone === "denied" ? "denied" : "unsupported");
  };

  const replay = () => {
    if (!currentNumber) return;
    setIsPaused(false);
    pausedRef.current = false;
    shouldKeepScreenAwakeRef.current = true;
    void requestScreenWakeLock();
    void playPrompt(currentNumber);
  };

  const togglePause = () => {
    if (isPaused) {
      setIsPaused(false);
      pausedRef.current = false;
      shouldKeepScreenAwakeRef.current = true;
      void requestScreenWakeLock();
      void playPrompt(currentNumber);
      return;
    }

    setIsPaused(true);
    pausedRef.current = true;
    shouldKeepScreenAwakeRef.current = false;
    releaseScreenWakeLock();
    stopRecognition();
    stopPlayback();
    setStatus("paused");
  };

  const leaveTraining = () => {
    stopRecognition();
    audioRef.current?.pause();
    stopCompletionSound();
    releaseAudioEngine();
    pausedRef.current = false;
    setScreen("select");
    setSelectedExam(null);
    setQueue([]);
    queueRef.current = [];
    setPosition(0);
    positionRef.current = 0;
    setStatus("idle");
    setHeard("");
    window.setTimeout(() => void startThemeMusic(), 0);
  };

  const restart = () => {
    if (!selectedExam) return;
    void startExam(selectedExam);
  };

  const closeIntro = () => {
    try {
      window.localStorage.setItem(INTRO_STORAGE_KEY, "true");
    } catch {
      // The guide can still be dismissed when storage is unavailable.
    }
    setShowIntro(false);
    void startThemeMusic();
  };

  const statusCopy = {
    idle: "Pronto",
    requesting: "Attivazione del microfono…",
    playing: "Ascolta il Chiến lược",
    listening: "Ti ascolto. Dì “PROSSIMO” quando hai finito.",
    paused: "Allenamento in pausa",
    unsupported: "Comando vocale non disponibile. Usa “Avanti”.",
    denied: "Autorizza il microfono nelle impostazioni del browser.",
    error: "Non riesco ad ascoltare. Usa “Avanti” o riprova.",
  }[status];

  if (screen === "stats") {
    return <StatsDashboard onBack={() => setScreen("select")} />;
  }

  if (screen === "complete" && selectedExam) {
    return (
      <main className="app-shell completion-shell">
        <div className="grain" aria-hidden="true" />
        <section className="completion-card">
          <p className="overline">Sessione completata</p>
          <div className="completion-mark" aria-hidden="true">
            完
          </div>
          <h1>Ottimo lavoro.</h1>
          <p className="completion-lead">
            Hai ripassato tutti i {selectedExam.max} Chiến lược richiesti per{" "}
            <strong>{selectedExam.title}</strong>.
          </p>

          <div className="session-stats">
            <div>
              <span>Completati</span>
              <strong>{selectedExam.max}</strong>
            </div>
            <div>
              <span>Tempo</span>
              <strong>{formatDuration(elapsedSeconds)}</strong>
            </div>
          </div>

          <div className="completion-actions">
            <button className="primary-action" onClick={restart}>
              Ripeti l’esame
            </button>
            <button className="text-action" onClick={leaveTraining}>
              Scegli un altro grado
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "training" && selectedExam) {
    const progress = ((position + 1) / queue.length) * 100;

    return (
      <main className="app-shell training-shell">
        <div className="grain" aria-hidden="true" />

        <header className="training-header">
          <button
            className="back-button"
            onClick={leaveTraining}
            aria-label="Torna alla selezione dell’esame"
          >
            <span aria-hidden="true">←</span>
            Esami
          </button>
          <div className="exam-label">
            <span>{selectedExam.eyebrow}</span>
            <strong>{selectedExam.title}</strong>
          </div>
          <div className="progress-count" aria-label={`Domanda ${position + 1} di ${queue.length}`}>
            <strong>{position + 1}</strong>
            <span>/ {queue.length}</span>
          </div>
        </header>

        <div className="progress-track" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <section className="training-stage">
          <div className={`voice-orb status-${status}`} aria-hidden="true">
            <div className="voice-ring voice-ring-one" />
            <div className="voice-ring voice-ring-two" />
            <div className="voice-core">
              {status === "playing" ? (
                <span className="sound-bars">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <span className="voice-word">Prossimo</span>
              )}
            </div>
          </div>

          <div className="status-block" aria-live="polite">
            <p className="status-kicker">
              {status === "listening"
                ? "Riconoscimento preciso"
                : "Interrogazione"}
            </p>
            <h1>{statusCopy}</h1>
            <p className="heard-copy">
              {heard ? `Ho sentito: “${heard}”` : "\u00a0"}
            </p>
          </div>

          {status === "denied" ||
          status === "unsupported" ||
          status === "error" ? (
            <button
              className="mic-retry-button"
              onClick={() => void retryMicrophone()}
            >
              <span aria-hidden="true">●</span>
              Attiva il microfono
            </button>
          ) : null}

          <div className="training-controls">
            <button
              className="control-button"
              onClick={replay}
              aria-label="Ripeti l’audio del Chiến lược"
            >
              <span aria-hidden="true">↻</span>
              Ripeti
            </button>
            <button
              className="control-button control-button-main"
              onClick={advance}
              aria-label="Passa al prossimo Chiến lược"
            >
              <span aria-hidden="true">→</span>
              Avanti
            </button>
            <button
              className="control-button"
              onClick={togglePause}
              aria-label={isPaused ? "Riprendi l’allenamento" : "Metti in pausa"}
            >
              <span aria-hidden="true">{isPaused ? "▶" : "Ⅱ"}</span>
              {isPaused ? "Riprendi" : "Pausa"}
            </button>
          </div>

          <p className="fallback-note">
            L’app avanza soltanto quando il riconoscimento trascrive la parola
            “PROSSIMO”. Se il browser non offre il riconoscimento preciso,
            “Avanti” resta sempre disponibile.
          </p>
          {screenAwake ? (
            <p className="screen-awake-note" aria-live="polite">
              <span aria-hidden="true">●</span>
              Schermo mantenuto acceso durante l’allenamento
            </p>
          ) : null}
        </section>

        <aside className="completed-strip" aria-label="Chiến lược già completati">
          <span>Completati</span>
          <div>
            {completedNumbers.length === 0 ? (
              <em>Nessuno</em>
            ) : (
              completedNumbers.map((number) => (
                <b key={number}>{number.toString().padStart(2, "0")}</b>
              ))
            )}
          </div>
        </aside>
      </main>
    );
  }

  return (
    <main
      className="app-shell selection-shell"
      onPointerDown={() => void startThemeMusic()}
    >
      <div className="grain" aria-hidden="true" />
      <header className="brand-header">
        <div className="brand-logos">
          <img
            className="brand-logo"
            src="images/logo-palestra-baolan.png"
            alt="Logo della Palestra Bao Lan"
            width="186"
            height="186"
          />
          <img
            className="brand-logo"
            src="images/logo-viet-vo-dao.png"
            alt="Logo Việt Võ Đạo"
            width="186"
            height="186"
          />
          <img
            className="brand-logo"
            src="images/logo-wvvdf.png"
            alt="Logo World Viet Vo Dao Federation"
            width="186"
            height="186"
          />
        </div>
        <div className="brand-copy">
          <span>Việt Võ Đạo</span>
          <strong>Chiến lược trainer</strong>
        </div>
        <div className="header-actions">
          <button
            className="guide-button stats-nav-button"
            onClick={() => setScreen("stats")}
          >
            <span aria-hidden="true">▥</span>
            Statistiche
          </button>
          <button className="guide-button" onClick={() => setShowIntro(true)}>
            <span aria-hidden="true">?</span>
            Come funziona
          </button>
        </div>
      </header>

      <section className="hero-copy">
        <p className="overline">Preparazione agli esami</p>
        <h1>
          Allenati come
          <br />
          <em>all’interrogazione.</em>
        </h1>
        <p>
          Scegli il grado che stai preparando. Ascolta il comando, esegui la
          tecnica e dì <strong>“PROSSIMO”</strong> per continuare.
        </p>
      </section>

      <section className="exam-section" aria-labelledby="exam-title">
        <div className="section-heading">
          <h2 id="exam-title">Quale esame prepari?</h2>
          <span>Sessione completa · ordine casuale</span>
        </div>

        <div className="exam-grid">
          {EXAMS.map((exam, index) => (
            <button
              key={exam.id}
              className={`exam-card exam-card-${exam.tone}`}
              onClick={() => void selectExam(exam)}
              style={{ "--card-order": index } as React.CSSProperties}
            >
              <span className="exam-eyebrow">{exam.eyebrow}</span>
              <strong>{exam.title}</strong>
              <span className="exam-range">
                Chiến lược <b>1–{exam.max}</b>
              </span>
              <span className="exam-arrow" aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="credits-section" aria-labelledby="credits-title">
        <div>
          <h2 id="credits-title">Ringraziamenti</h2>
        </div>
        <p>
          Dedicato alla{" "}
          <a
            href="https://www.palestrabaolan.it/"
            target="_blank"
            rel="noreferrer"
          >
            Palestra Bao Lan
          </a>{" "}
          e a tutti gli insegnanti e praticanti che mantengono viva la pratica
          del Việt Võ Đạo.
        </p>
        <div className="creator-credit">
          <span>
            Ideazione e realizzazione
            <strong>Paolo Pasquetto · Bao Chien</strong>
          </span>
          <a
            className="coffee-button"
            href="https://paypal.me/paolopasquetto"
            target="_blank"
            rel="noreferrer"
          >
            <span aria-hidden="true">☕</span>
            Se ti piace l’app, offrimi un caffè
          </a>
        </div>
      </section>

      <footer className="selection-footer">
        <span>
          <i className="status-dot" aria-hidden="true" />
          {offlineReady
            ? "Audio e musica pronti anche offline"
            : isOnline
              ? "Audio e musica pronti"
              : "Modalità offline"}
        </span>
        <span>Voce o pulsante “Avanti”</span>
      </footer>

      {showIntro ? (
        <div className="intro-backdrop" role="presentation">
          <section
            className="intro-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="intro-title"
            aria-describedby="intro-description"
          >
            <button
              className="intro-close"
              onClick={closeIntro}
              aria-label="Chiudi la guida"
            >
              ×
            </button>

            <div className="intro-heading">
              <div className="intro-logos" aria-hidden="true">
                <img
                  src="images/logo-palestra-baolan.png"
                  alt=""
                  width="72"
                  height="72"
                />
                <img
                  src="images/logo-viet-vo-dao.png"
                  alt=""
                  width="72"
                  height="72"
                />
                <img
                  src="images/logo-wvvdf.png"
                  alt=""
                  width="72"
                  height="72"
                />
              </div>
              <div>
                <p>Benvenuto</p>
                <h2 id="intro-title">Come funziona</h2>
              </div>
            </div>

            <p id="intro-description" className="intro-lead">
              Simula l’interrogazione dei Chiến lược richiesti per il tuo
              passaggio di grado.
            </p>

            <ol className="intro-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Scegli l’esame</strong>
                  <p>
                    L’app prepara tutti i Chiến lược richiesti e li propone in
                    ordine casuale.
                  </p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Ascolta ed esegui</strong>
                  <p>
                    Dopo ogni audio esegui la tecnica, poi dì “PROSSIMO” o
                    tocca “Avanti”.
                  </p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Allenati anche offline</strong>
                  <p>
                    Aggiungi l’app alla schermata Home. Senza rete gli audio e
                    il pulsante “Avanti” restano disponibili. Durante la
                    sessione l’app prova a mantenere lo schermo acceso; usa
                    “Pausa” se vuoi consentire il blocco automatico.
                  </p>
                </div>
              </li>
            </ol>

            <div className="install-hints" aria-label="Istruzioni di installazione">
              <span>iPhone: Condividi → Aggiungi alla schermata Home</span>
              <span>Android: menu browser → Installa app</span>
            </div>

            <button className="primary-action intro-action" onClick={closeIntro}>
              Ho capito, iniziamo
            </button>
            <p className="voice-caveat">
              Il comando vocale usa il riconoscimento preciso del browser e
              accetta soltanto la parola “PROSSIMO”. Se non è disponibile o il
              permesso viene bloccato, usa “Attiva il microfono” oppure
              “Avanti” durante l’allenamento.
            </p>
          </section>
        </div>
      ) : null}
    </main>
  );
}
