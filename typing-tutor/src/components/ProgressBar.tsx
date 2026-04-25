interface ProgressBarProps {
  progress: number;
}

export function ProgressBar({ progress }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, progress * 100));
  return (
    <div className="w-full h-4 rounded-full bg-gray-200 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{
          width: `${pct}%`,
          background: 'linear-gradient(90deg, #f472b6, #facc15, #34d399, #60a5fa)',
        }}
      />
    </div>
  );
}
