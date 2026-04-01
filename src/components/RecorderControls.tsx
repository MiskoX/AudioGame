type RecorderControlsProps = {
  isRecording: boolean;
  isPlaying: boolean;
  isPostProcessing: boolean;
  hasRecording: boolean;
  recordLabel: string;
  stopLabel: string;
  playLabel: string;
  reverseLabel: string;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onPlayRecording: () => void;
  onPlayRecordingReversed: () => void;
};

export function RecorderControls({
  isRecording,
  isPlaying,
  isPostProcessing,
  hasRecording,
  recordLabel,
  stopLabel,
  playLabel,
  reverseLabel,
  onStartRecording,
  onStopRecording,
  onPlayRecording,
  onPlayRecordingReversed,
}: RecorderControlsProps) {
  return (
    <div className="buttons">
      <button
        className="btn btn-record"
        type="button"
        onClick={isRecording ? onStopRecording : onStartRecording}
        disabled={isPlaying || isPostProcessing}
      >
        <span className={`icon ${isRecording ? "icon-stop" : "icon-rec"}`} />
        <span>{isRecording ? stopLabel : recordLabel}</span>
      </button>

      <button
        className="btn btn-play"
        type="button"
        onClick={onPlayRecording}
        disabled={!hasRecording || isRecording || isPlaying || isPostProcessing}
      >
        <span className="icon icon-play" />
        <span>{playLabel}</span>
      </button>

      <button
        className="btn btn-reverse"
        type="button"
        onClick={onPlayRecordingReversed}
        disabled={!hasRecording || isRecording || isPlaying || isPostProcessing}
      >
        <span className="icon icon-play" />
        <span>{reverseLabel}</span>
      </button>
    </div>
  );
}
