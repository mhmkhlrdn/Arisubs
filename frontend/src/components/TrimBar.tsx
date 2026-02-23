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
    // Left click (0) sets start if on scrub, or drags whatever was clicked
    // Right click (2) sets end if on scrub
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

  return (
    <div className="w-full">
      <div
        ref={barRef}
        className="relative h-12 bg-gray-700 rounded-lg cursor-pointer"
        onMouseDown={(e) => handleMouseDown(e, 'scrub')}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Selected region highlight */}
        <div
          className="absolute h-full bg-blue-500/30"
          style={{
            left: `${startPercent}%`,
            width: `${widthPercent}%`,
          }}
        />

        {/* Start handle */}
        <motion.div
          className="absolute top-0 bottom-0 w-2 bg-blue-500 cursor-ew-resize z-10"
          style={{ left: `${startPercent}%` }}
          onMouseDown={(e) => {
            e.stopPropagation()
            handleMouseDown(e, 'start')
          }}
          whileHover={{ scaleX: 1.5 }}
        />

        {/* End handle */}
        <motion.div
          className="absolute top-0 bottom-0 w-2 bg-blue-500 cursor-ew-resize z-10"
          style={{ left: `${endPercent}%` }}
          onMouseDown={(e) => {
            e.stopPropagation()
            handleMouseDown(e, 'end')
          }}
          whileHover={{ scaleX: 1.5 }}
        />
      </div>

      <div className="flex justify-between mt-2 text-sm text-gray-400">
        <span>Start: {formatTime(start)}</span>
        <span>End: {formatTime(end)}</span>
        <span>Duration: {formatTime(end - start)}</span>
      </div>
    </div>
  )
}
