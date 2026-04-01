import { useEffect, useRef, useState } from "react";
import {
  loadRnnoise,
  RnnoiseWorkletNode,
} from "@sapphi-red/web-noise-suppressor";
import rnnoiseWorkletPath from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import { RECORDING_DURATION_MS } from "../constants/audio";
import {
  CRISP_MIC_CONSTRAINTS,
  RNNOISE_PROCESSING_SAMPLE_RATE,
} from "../constants/crispAudio";

type TimerRef = { current: number | null };
type NormalizedRecordingData = {
  sampleRate: number;
  length: number;
  channelData: Float32Array[];
};

const PEAK_NORMALIZATION_TARGET_LINEAR = 10 ** (-1 / 20);

export type RecorderStatusKey =
  | "idle"
  | "requestMic"
  | "readyManual"
  | "readyAuto"
  | "recording"
  | "stopping"
  | "missingRecording"
  | "playNormal"
  | "playNormalDone"
  | "playNormalError"
  | "playReverse"
  | "playReverseDone"
  | "playReverseError"
  | "micError";

export function useAudioRecorder() {
  const [statusKey, setStatusKey] = useState<RecorderStatusKey>("idle");
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPostProcessing, setIsPostProcessing] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [playbackElapsedMs, setPlaybackElapsedMs] = useState(0);
  const [recordedDurationMs, setRecordedDurationMs] = useState(
    RECORDING_DURATION_MS,
  );
  const [timelineMode, setTimelineMode] = useState<
    "idle" | "recording" | "playback"
  >("idle");
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const progressIntervalRef = useRef<number | null>(null);
  const playbackIntervalRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processingContextRef = useRef<AudioContext | null>(null);
  const rnnoiseWasmRef = useRef<ArrayBuffer | null>(null);
  const rnnoiseNodeRef = useRef<RnnoiseWorkletNode | null>(null);
  const normalizedRecordingRef = useRef<NormalizedRecordingData | null>(null);
  const wasManualStopRef = useRef(false);

  const timelineTotalMs =
    timelineMode === "recording" ? RECORDING_DURATION_MS : recordedDurationMs;
  const timelineElapsedMs =
    timelineMode === "recording" ? recordingElapsedMs : playbackElapsedMs;
  const progressPercent = Math.min(
    (timelineElapsedMs / Math.max(timelineTotalMs, 1)) * 100,
    100,
  );

  const hasRecording = recordedBlob !== null;

  function stopStream() {
    if (
      recorderStreamRef.current &&
      recorderStreamRef.current !== streamRef.current
    ) {
      recorderStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
    }
    recorderStreamRef.current = null;

    if (!streamRef.current) {
      if (processingContextRef.current) {
        void processingContextRef.current.close();
        processingContextRef.current = null;
      }
      return;
    }

    streamRef.current.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;

    if (rnnoiseNodeRef.current) {
      rnnoiseNodeRef.current.destroy();
      rnnoiseNodeRef.current = null;
    }

    if (processingContextRef.current) {
      void processingContextRef.current.close();
      processingContextRef.current = null;
    }
  }

  async function createRnnoiseNode(
    context: AudioContext,
  ): Promise<RnnoiseWorkletNode | null> {
    if (!("audioWorklet" in context)) {
      return null;
    }

    try {
      if (!rnnoiseWasmRef.current) {
        rnnoiseWasmRef.current = await loadRnnoise({
          url: rnnoiseWasmPath,
          simdUrl: rnnoiseSimdWasmPath,
        });
      }

      await context.audioWorklet.addModule(rnnoiseWorkletPath);

      const rnnoise = new RnnoiseWorkletNode(context, {
        maxChannels: 1,
        wasmBinary: rnnoiseWasmRef.current,
      });
      rnnoiseNodeRef.current = rnnoise;
      return rnnoise;
    } catch {
      return null;
    }
  }

  async function getRecorderStream(inputStream: MediaStream) {
    const context = new AudioContext({
      sampleRate: RNNOISE_PROCESSING_SAMPLE_RATE,
    });
    const source = context.createMediaStreamSource(inputStream);
    const destination = context.createMediaStreamDestination();
    const rnnoiseNode = await createRnnoiseNode(context);
    if (!rnnoiseNode) {
      void context.close();
      throw new Error("RNNoise initialization failed");
    }

    source.connect(rnnoiseNode);
    rnnoiseNode.connect(destination);

    processingContextRef.current = context;
    return destination.stream;
  }

  function clearTimer(ref: TimerRef, type: "timeout" | "interval") {
    if (!ref.current) {
      return;
    }

    if (type === "timeout") {
      window.clearTimeout(ref.current);
    } else {
      window.clearInterval(ref.current);
    }
    ref.current = null;
  }

  function clearRecordingTimers() {
    clearTimer(timeoutRef, "timeout");
    clearTimer(progressIntervalRef, "interval");
  }

  function clearPlaybackTimer() {
    clearTimer(playbackIntervalRef, "interval");
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (progressIntervalRef.current) {
        window.clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      if (playbackIntervalRef.current) {
        window.clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
      stopStream();
      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
    };
  }, []);

  async function startRecording() {
    if (isRecording || isPlaying) {
      return;
    }

    setStatusKey("requestMic");

    try {
      const inputStream = await navigator.mediaDevices.getUserMedia({
        audio: CRISP_MIC_CONSTRAINTS,
      });
      streamRef.current = inputStream;

      const recorderStream = await getRecorderStream(inputStream);
      recorderStreamRef.current = recorderStream;

      chunksRef.current = [];
      normalizedRecordingRef.current = null;
      setRecordedBlob(null);
      setIsPostProcessing(false);
      wasManualStopRef.current = false;
      setRecordingElapsedMs(0);
      recordingStartedAtRef.current = Date.now();
      const recorder = new MediaRecorder(recorderStream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        clearRecordingTimers();
        setTimelineMode("idle");

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        const wasManualStop = wasManualStopRef.current;
        setIsRecording(false);
        setIsPostProcessing(true);
        setStatusKey("stopping");

        const startedAt = recordingStartedAtRef.current ?? Date.now();
        const durationMs = Math.max(Date.now() - startedAt, 300);
        setRecordedDurationMs(durationMs);
        setPlaybackElapsedMs(0);
        stopStream();

        void normalizeAndFinalizeRecording(blob, wasManualStop);
      };

      recorder.start();
      setIsRecording(true);
      setStatusKey("recording");
      setTimelineMode("recording");

      const startedAt = Date.now();
      recordingStartedAtRef.current = startedAt;
      progressIntervalRef.current = window.setInterval(() => {
        setRecordingElapsedMs(
          Math.min(Date.now() - startedAt, RECORDING_DURATION_MS),
        );
      }, 100);

      timeoutRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          wasManualStopRef.current = false;
          mediaRecorderRef.current.stop();
        }
      }, RECORDING_DURATION_MS);
    } catch {
      setStatusKey("micError");
      setIsRecording(false);
      setTimelineMode("idle");
      clearRecordingTimers();
      stopStream();
    }
  }

  function stopRecording() {
    if (!isRecording || mediaRecorderRef.current?.state !== "recording") {
      return;
    }

    clearRecordingTimers();

    wasManualStopRef.current = true;
    mediaRecorderRef.current.stop();
    setStatusKey("stopping");
  }

  function startPlaybackProgress(durationMs: number) {
    clearPlaybackTimer();
    setIsPlaying(true);
    setPlaybackElapsedMs(0);
    setTimelineMode("playback");

    const startedAt = Date.now();
    playbackIntervalRef.current = window.setInterval(() => {
      setPlaybackElapsedMs(Math.min(Date.now() - startedAt, durationMs));
    }, 100);
  }

  function finishPlaybackProgress() {
    clearPlaybackTimer();
    setIsPlaying(false);
    setTimelineMode("idle");
    setPlaybackElapsedMs(0);
  }

  async function getAudioContext() {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    const context = audioContextRef.current;
    if (context.state === "suspended") {
      await context.resume();
    }

    return context;
  }

  async function decodeRecordedBuffer(blob: Blob) {
    const context = await getAudioContext();
    const inputBuffer = await blob.arrayBuffer();
    const decodedBuffer = await context.decodeAudioData(inputBuffer);
    return { context, decodedBuffer };
  }

  async function normalizeAndFinalizeRecording(
    blob: Blob,
    wasManualStop: boolean,
  ) {
    try {
      const { decodedBuffer } = await decodeRecordedBuffer(blob);
      normalizedRecordingRef.current = normalizeDecodedBuffer(decodedBuffer);
    } catch {
      normalizedRecordingRef.current = null;
    } finally {
      setRecordedBlob(blob);
      setIsPostProcessing(false);
      setStatusKey(wasManualStop ? "readyManual" : "readyAuto");
    }
  }

  function normalizeDecodedBuffer(
    decodedBuffer: AudioBuffer,
  ): NormalizedRecordingData {
    const channelData = Array.from(
      { length: decodedBuffer.numberOfChannels },
      (_, channel) => new Float32Array(decodedBuffer.getChannelData(channel)),
    );

    let peak = 0;
    channelData.forEach((samples) => {
      for (let i = 0; i < samples.length; i += 1) {
        peak = Math.max(peak, Math.abs(samples[i]));
      }
    });

    const gain = peak > 0 ? PEAK_NORMALIZATION_TARGET_LINEAR / peak : 1;
    if (gain !== 1) {
      channelData.forEach((samples) => {
        for (let i = 0; i < samples.length; i += 1) {
          samples[i] *= gain;
        }
      });
    }

    return {
      sampleRate: decodedBuffer.sampleRate,
      length: decodedBuffer.length,
      channelData,
    };
  }

  async function getPlaybackBuffer(blob: Blob) {
    const context = await getAudioContext();
    const normalized = normalizedRecordingRef.current;

    if (!normalized) {
      const inputBuffer = await blob.arrayBuffer();
      const decodedBuffer = await context.decodeAudioData(inputBuffer);
      return { context, decodedBuffer };
    }

    const normalizedBuffer = context.createBuffer(
      normalized.channelData.length,
      normalized.length,
      normalized.sampleRate,
    );

    normalized.channelData.forEach((samples, channel) => {
      normalizedBuffer.getChannelData(channel).set(samples);
    });

    return { context, decodedBuffer: normalizedBuffer };
  }

  function getRecordingBlobOrStatusError() {
    if (!recordedBlob) {
      setStatusKey("missingRecording");
      return null;
    }
    return recordedBlob;
  }

  function playBuffer(
    context: AudioContext,
    buffer: AudioBuffer,
    startStatus: RecorderStatusKey,
    endStatus: RecorderStatusKey,
    errorStatus: RecorderStatusKey,
  ) {
    const sourceNode = context.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.connect(context.destination);

    const durationMs = Math.max(buffer.duration * 1000, 300);
    setStatusKey(startStatus);
    startPlaybackProgress(durationMs);

    sourceNode.onended = () => {
      finishPlaybackProgress();
      setStatusKey(endStatus);
    };

    try {
      sourceNode.start();
    } catch {
      finishPlaybackProgress();
      setStatusKey(errorStatus);
    }
  }

  async function playRecording() {
    if (isPlaying) {
      return;
    }

    const blob = getRecordingBlobOrStatusError();
    if (!blob) {
      return;
    }

    try {
      const { context, decodedBuffer } = await getPlaybackBuffer(blob);
      playBuffer(
        context,
        decodedBuffer,
        "playNormal",
        "playNormalDone",
        "playNormalError",
      );
    } catch {
      finishPlaybackProgress();
      setStatusKey("playNormalError");
    }
  }

  async function playRecordingReversed() {
    if (isPlaying) {
      return;
    }

    const blob = getRecordingBlobOrStatusError();
    if (!blob) {
      return;
    }

    try {
      const { context, decodedBuffer } = await getPlaybackBuffer(blob);

      const reversedBuffer = context.createBuffer(
        decodedBuffer.numberOfChannels,
        decodedBuffer.length,
        decodedBuffer.sampleRate,
      );

      for (
        let channel = 0;
        channel < decodedBuffer.numberOfChannels;
        channel += 1
      ) {
        const source = decodedBuffer.getChannelData(channel);
        const target = reversedBuffer.getChannelData(channel);
        for (let i = 0; i < source.length; i += 1) {
          target[i] = source[source.length - 1 - i];
        }
      }

      playBuffer(
        context,
        reversedBuffer,
        "playReverse",
        "playReverseDone",
        "playReverseError",
      );
    } catch {
      finishPlaybackProgress();
      setStatusKey("playReverseError");
    }
  }

  return {
    statusKey,
    isRecording,
    isPlaying,
    isPostProcessing,
    hasRecording,
    progressPercent,
    timelineElapsedMs,
    timelineTotalMs,
    startRecording,
    stopRecording,
    playRecording,
    playRecordingReversed,
  };
}
