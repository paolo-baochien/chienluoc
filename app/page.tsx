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

const INTRO_STORAGE_KEY = "chien-luoc-intro-seen-v1";

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
    window.setTimeout(() => {
      try {
        audioSession.type = "auto";
      } catch {
        // Some Safari versions expose the API without allowing every change.
      }
    }, 0);
    return true;
  } catch {
    return false;
  }
}

export default function Home() {
  const [screen, setScreen] = useState<"select" | "training" | "complete">(
    "select",
  );
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
  const completionAudioRef = useRef<HTMLAudioElement | null>(null);
  const completionSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const completionAudioTokenRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackGainRef = useRef<GainNode | null>(null);
  const playbackCompressorRef = useRef<DynamicsCompressorNode | null>(null);
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

  const stopThemeMusic = useCallback(() => {
    const theme = themeAudioRef.current;
    if (!theme) return;

    theme.pause();
    theme.currentTime = 0;
  }, []);

  const startThemeMusic = useCallback(async () => {
    let theme = themeAudioRef.current;

    if (!theme) {
      theme = new Audio("audio/theme.mp3");
      theme.preload = "auto";
      theme.loop = true;
      theme.volume = 0.6;
      themeAudioRef.current = theme;
    }

    if (!theme.paused) return;
    await theme.play().catch(() => undefined);
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
    restoreAudioSessionForPlayback();
    stopPlayback();
    audioBufferCacheRef.current.clear();
    playbackGainRef.current?.disconnect();
    playbackGainRef.current = null;
    playbackCompressorRef.current?.disconnect();
    playbackCompressorRef.current = null;
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
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    }
    if (completionToken !== completionAudioTokenRef.current) return;

    const context = await ensureAudioContext().catch(() => null);
    if (context && context.state !== "closed") {
      try {
        let completionBuffer = audioBufferCacheRef.current.get("fine");
        if (!completionBuffer) {
          const response = await fetch("audio/fine.mp3", {
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

    const completion = new Audio("audio/fine.mp3");
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
        await new Promise((resolve) => window.setTimeout(resolve, 260));
        if (playbackToken !== playbackTokenRef.current || pausedRef.current) {
          return;
        }
      }

      const context = audioContextRef.current;
      if (context && context.state !== "closed") {
        try {
          if (!playbackGainRef.current || !playbackCompressorRef.current) {
            const gain = context.createGain();
            const compressor = context.createDynamicsCompressor();
            gain.gain.value = 1.7;
            compressor.threshold.value = -15;
            compressor.knee.value = 16;
            compressor.ratio.value = 7;
            compressor.attack.value = 0.004;
            compressor.release.value = 0.22;
            gain.connect(compressor);
            compressor.connect(context.destination);
            playbackGainRef.current = gain;
            playbackCompressorRef.current = compressor;
          }

          if (context.state === "suspended") {
            await context.resume();
          }

          let audioBuffer = audioBufferCacheRef.current.get(number);
          if (!audioBuffer) {
            const response = await fetch(`audio/${number}.mp3`, {
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

      const audio = new Audio(`audio/${number}.mp3`);
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
    stopPlayback,
    stopRecognition,
  ]);

  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

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

    const updateConnection = () => setIsOnline(navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);

    if (
      "serviceWorker" in navigator &&
      process.env.NODE_ENV === "production"
    ) {
      void navigator.serviceWorker
        .register("sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then(() => setOfflineReady(true))
        .catch(() => setOfflineReady(false));
    }

    return () => {
      window.clearTimeout(introTimer);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
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
    return () => {
      audioRef.current?.pause();
      stopThemeMusic();
      stopCompletionSound();
      releaseAudioEngine();
    };
  }, [
    releaseAudioEngine,
    stopCompletionSound,
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
      await new Promise((resolve) => window.setTimeout(resolve, 260));

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

    await audioContextReady.catch(() => null);
    const microphone = await requestMicrophone();
    if (microphone === "denied") setStatus("denied");
    if (microphone === "unsupported") setStatus("unsupported");

    void playPrompt(newQueue[0]);
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
            src="images/logo-baolan.jpg"
            alt="Logo della Palestra Bao Lan"
            width="54"
            height="50"
          />
          <img
            className="brand-logo brand-logo-viet"
            src="images/logo-viet-vo-dao-italia.png"
            alt="Logo Việt Võ Đạo Italia"
            width="52"
            height="52"
          />
        </div>
        <div className="brand-copy">
          <span>Bảo Lan · Việt Võ Đạo</span>
          <strong>Chiến lược trainer</strong>
        </div>
        <button className="guide-button" onClick={() => setShowIntro(true)}>
          <span aria-hidden="true">?</span>
          Come funziona
        </button>
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
              onClick={() => void startExam(exam)}
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
                  src="images/logo-baolan.jpg"
                  alt=""
                  width="70"
                  height="65"
                />
                <img
                  src="images/logo-viet-vo-dao-italia.png"
                  alt=""
                  width="65"
                  height="65"
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
