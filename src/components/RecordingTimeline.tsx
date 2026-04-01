import { formatTime } from "../utils/formatTime";

type RecordingTimelineProps = {
  progressPercent: number;
  elapsedMs: number;
  totalMs: number;
  progressLabel: string;
};

export function RecordingTimeline({
  progressPercent,
  elapsedMs,
  totalMs,
  progressLabel,
}: RecordingTimelineProps) {
  return (
    <>
      <div className="recording-progress" aria-label={progressLabel}>
        <div
          className="recording-progress-fill"
          style={{ width: `${progressPercent.toString()}%` }}
        />
      </div>
      <div className="recording-time">
        <span>{formatTime(elapsedMs)}</span>
        <span>{formatTime(totalMs)}</span>
      </div>
    </>
  );
}
