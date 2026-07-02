export function CandleLoading({ text = "촛불을 켜는 중…" }: { text?: string }) {
  return (
    <div className="hs-candle-loading">
      <span className="hs-candle-loading__flame" aria-hidden />
      <span>{text}</span>
    </div>
  );
}
