import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'

interface TrimBarProps {
  duration: number  // total video duration in seconds
  start: number     // current start time
  end: number       // current end time
  onStartChange: (start: number) => void
  onEndChange: (end: number) => void
  onSeek?: (time: number) => void
}

export function TrimBar({ duration, start, end, onStartChange, onEndChange, onSeek }: TrimBarProps) {
  const [isDragging, setIsDragging] = useState<'start' | 'end' | 'scrub' | null>(null)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState(0)
  const barRef = useRef<HTMLDivElement>(null)

  // Guard against invalid duration
  if (!duration || duration <= 0 || !isFinite(duration)) {
    return (
      <div className="w-full text-center text-gray-400 py-4">
        Loading timeline...
      </div>
    )
  }

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 100)

    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
    }
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
  }

  const getTimeFromX = (clientX: number): number => {
    if (!barRef.current) return 0
    const rect = barRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const ratio = Math.max(0, Math.min(1, x / rect.width))
    return ratio * duration
  }

  const handleMouseDown = (e: React.MouseEvent, type: 'start' | 'end' | 'scrub') => {
    if (type === 'scrub') {
      const time = getTimeFromX(e.clientX)
      if (e.button === 0) {
        onStartChange(Math.max(0, Math.min(time, duration)))
        setIsDragging('start')
      } else if (e.button === 2) {
        onEndChange(Math.min(duration, Math.max(time, start + 0.1)))
        setIsDragging('end')
      }
      if (onSeek) onSeek(time)
    } else {
      setIsDragging(type)
    }
  }

  const handleBarMouseMove = (e: React.MouseEvent) => {
    if (!barRef.current) return
    const rect = barRef.current.getBoundingClientRect()
    setHoverX(e.clientX - rect.left)
    setHoverTime(getTimeFromX(e.clientX))
  }

  const handleBarMouseLeave = () => {
    setHoverTime(null)
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const time = getTimeFromX(e.clientX)

      if (isDragging === 'start') {
        onStartChange(Math.max(0, Math.min(time, duration)))
      } else if (isDragging === 'end') {
        onEndChange(Math.min(duration, Math.max(time, start + 0.1)))
      } else if (isDragging === 'scrub' && onSeek) {
        onSeek(time)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, duration, start, end, onStartChange, onEndChange, onSeek])

  const startPercent = (start / duration) * 100
  const endPercent = (end / duration) * 100
  const widthPercent = endPercent - startPercent
  const barWidth = barRef.current?.clientWidth || 300

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      {/* Hover tooltip - rendered OUTSIDE the overflow:hidden bar */}
      {hoverTime !== null && !isDragging && (
        <div
          style={{
            position: 'absolute',
            left: Math.max(35, Math.min(hoverX, barWidth - 35)),
            top: -20,
            transform: 'translateX(-50%)',
            zIndex: 50,
            pointerEvents: 'none',
          }}
        >
          <div style={{
            background: '#11111b',
            color: '#cdd6f4',
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 3,
            border: '1px solid #45475a',
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
            whiteSpace: 'nowrap',
            fontFamily: "'Consolas', 'Courier New', monospace",
          }}>
            {formatTime(hoverTime)}
          </div>
        </div>
      )}

      {/* The actual bar */}
      <div
        ref={barRef}
        className="relative h-8 bg-gray-700 rounded cursor-pointer overflow-hidden"
        onMouseDown={(e) => handleMouseDown(e, 'scrub')}
        onMouseMove={handleBarMouseMove}
        onMouseLeave={handleBarMouseLeave}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Selected region highlight */}
        <div
          className="absolute h-full bg-blue-500/25"
          style={{
            left: `${startPercent}%`,
            width: `${widthPercent}%`,
          }}
        />

        {/* Start handle */}
        <motion.div
          className="absolute top-0 bottom-0 w-1.5 bg-green-400 cursor-ew-resize z-10 rounded-sm"
          style={{ left: `${startPercent}%` }}
          onMouseDown={(e) => {
            e.stopPropagation()
            handleMouseDown(e, 'start')
          }}
          whileHover={{ scaleX: 2 }}
        />

        {/* End handle */}
        <motion.div
          className="absolute top-0 bottom-0 w-1.5 bg-red-400 cursor-ew-resize z-10 rounded-sm"
          style={{ left: `${endPercent}%` }}
          onMouseDown={(e) => {
            e.stopPropagation()
            handleMouseDown(e, 'end')
          }}
          whileHover={{ scaleX: 2 }}
        />

        {/* Hover indicator line inside the bar */}
        {hoverTime !== null && !isDragging && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: 1,
              left: hoverX,
              background: 'rgba(255,255,255,0.5)',
              pointerEvents: 'none',
              zIndex: 20,
            }}
          />
        )}

        {/* Hint text */}
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-500 pointer-events-none">
          Left click = Set Start &nbsp;·&nbsp; Right click = Set End
        </div>
      </div>

      <div className="flex justify-between mt-1 text-[10px] text-gray-500">
        <span>Start: {formatTime(start)}</span>
        <span>End: {formatTime(end)}</span>
        <span>Duration: {formatTime(end - start)}</span>
      </div>
    </div>
  )
}
