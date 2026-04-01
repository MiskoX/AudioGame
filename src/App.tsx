import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RecorderControls } from "./components/RecorderControls";
import { RecordingTimeline } from "./components/RecordingTimeline";
import { useAudioRecorder } from "./hooks/useAudioRecorder";
import "./App.css";

function getInitialTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function App() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<"light" | "dark">(getInitialTheme);
  const isPolish = i18n.language.startsWith("pl");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.title = "Audio Game";
  }, []);

  const {
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
  } = useAudioRecorder();

  function toggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  function toggleLanguage() {
    void i18n.changeLanguage(isPolish ? "en" : "pl");
  }

  return (
    <main className="app">
      <div className="top-actions">
        <button
          className="chip"
          type="button"
          onClick={toggleTheme}
          aria-label={
            theme === "dark" ? t("controls.light") : t("controls.dark")
          }
        >
          {theme === "dark" ? "🌞" : "🌙"}
        </button>
        <button
          className="chip"
          type="button"
          onClick={toggleLanguage}
          aria-label={isPolish ? "Switch to English" : "Przełącz na polski"}
        >
          <span className={`flag ${isPolish ? "flag-gb" : "flag-pl"}`} />
        </button>
      </div>

      <p className="status">{t(`status.${statusKey}`)}</p>

      <RecordingTimeline
        progressPercent={progressPercent}
        elapsedMs={timelineElapsedMs}
        totalMs={timelineTotalMs}
        progressLabel={t("timeline.progress")}
      />

      <RecorderControls
        isRecording={isRecording}
        isPlaying={isPlaying}
        isPostProcessing={isPostProcessing}
        hasRecording={hasRecording}
        recordLabel={t("buttons.record")}
        stopLabel={t("buttons.stop")}
        playLabel={t("buttons.play")}
        reverseLabel={t("buttons.reverse")}
        onStartRecording={() => {
          void startRecording();
        }}
        onStopRecording={stopRecording}
        onPlayRecording={() => {
          void playRecording();
        }}
        onPlayRecordingReversed={() => {
          void playRecordingReversed();
        }}
      />
    </main>
  );
}

export default App;
