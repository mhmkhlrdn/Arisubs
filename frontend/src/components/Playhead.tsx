interface PlayheadProps {
  position: number  // in seconds
  pixelsPerSecond: number
  height: number
}

export function Playhead({ position, pixelsPerSecond, height }: PlayheadProps) {
  const left = position * pixelsPerSecond

  return (
    <div
      className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none"
      style={{
        left: `${left}px`,
        height: `${height}px`,
      }}
    >
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-red-500" />
    </div>
  )
}
