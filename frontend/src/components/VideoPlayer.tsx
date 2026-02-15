import { useRef, useEffect } from 'react'

interface VideoPlayerProps {
  src: string
  currentTime?: number
  onTimeUpdate?: (time: number) => void
  className?: string
}

export function VideoPlayer({ src, currentTime, onTimeUpdate, className = '' }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  // Reset video when src changes
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    
    // Reset video when src changes
    video.load()
  }, [src])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (currentTime !== undefined && Math.abs(video.currentTime - currentTime) > 0.5) {
      video.currentTime = currentTime
    }
  }, [currentTime])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !onTimeUpdate) return

    const handleTimeUpdate = () => {
      onTimeUpdate(video.currentTime)
    }

    video.addEventListener('timeupdate', handleTimeUpdate)
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate)
    }
  }, [onTimeUpdate])

  return (
    <video
      ref={videoRef}
      src={src}
      controls
      className={`w-full h-full object-contain rounded-lg ${className}`}
    />
  )
}
