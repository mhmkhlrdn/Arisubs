import { useRef, useEffect, useState } from 'react'
import { Play, Pause, RotateCcw, Maximize } from 'lucide-react'

interface ClipPreviewProps {
  src: string
  startTime: number
  endTime: number
  className?: string
}

export function ClipPreview({ src, startTime, endTime, className = '' }: ClipPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [isLooping, setIsLooping] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const duration = endTime - startTime

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Set initial time to start
    video.currentTime = startTime

    const handleTimeUpdate = () => {
      const time = video.currentTime
      setCurrentTime(time - startTime)

      // Loop back to start if we've reached the end
      if (isLooping && time >= endTime) {
        video.currentTime = startTime
      } else if (!isLooping && time >= endTime) {
        video.pause()
        setIsPlaying(false)
        video.currentTime = startTime
      }
    }

    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    const handleEnded = () => {
      if (isLooping) {
        video.currentTime = startTime
        video.play()
      } else {
        setIsPlaying(false)
        video.currentTime = startTime
      }
    }

    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('ended', handleEnded)

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('ended', handleEnded)
    }
  }, [startTime, endTime, isLooping])

  // Reset video position when start/end times change
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = startTime
    setCurrentTime(0)
  }, [startTime, endTime])

  const handlePlayPause = () => {
    const video = videoRef.current
    if (!video) return

    if (isPlaying) {
      video.pause()
    } else {
      if (video.currentTime < startTime || video.currentTime >= endTime) {
        video.currentTime = startTime
      }
      video.play()
    }
  }

  const handleReset = () => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    video.currentTime = startTime
    setIsPlaying(false)
    setCurrentTime(0)
  }

  const handleFullscreen = async () => {
    const container = containerRef.current
    if (!container) return

    try {
      if (!isFullscreen) {
        if (container.requestFullscreen) {
          await container.requestFullscreen()
        } else if ((container as any).webkitRequestFullscreen) {
          await (container as any).webkitRequestFullscreen()
        } else if ((container as any).mozRequestFullScreen) {
          await (container as any).mozRequestFullScreen()
        } else if ((container as any).msRequestFullscreen) {
          await (container as any).msRequestFullscreen()
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen()
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen()
        } else if ((document as any).mozCancelFullScreen) {
          await (document as any).mozCancelFullScreen()
        } else if ((document as any).msExitFullscreen) {
          await (document as any).msExitFullscreen()
        }
      }
    } catch (err) {
      console.error('Error toggling fullscreen:', err)
    }
  }

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement || !!(document as any).webkitFullscreenElement || !!(document as any).mozFullScreenElement || !!(document as any).msFullscreenElement)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('mozfullscreenchange', handleFullscreenChange)
    document.addEventListener('MSFullscreenChange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
    }
  }, [])

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

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div ref={containerRef} className={`${className} ${isFullscreen ? 'fixed inset-0 z-[100] bg-black flex flex-col' : 'h-full flex flex-col'}`}>
      {!isFullscreen && (
        <div className="flex items-center justify-between mb-2">
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={isLooping}
              onChange={(e) => setIsLooping(e.target.checked)}
              className="w-3 h-3"
            />
            <span>Loop</span>
          </label>
          <button
            onClick={handleFullscreen}
            className="text-gray-400 hover:text-white transition-colors p-1"
            title="Enter Fullscreen"
          >
            <Maximize size={16} />
          </button>
        </div>
      )}

      <div
        className="relative flex-1 bg-black cursor-pointer rounded overflow-hidden"
        style={{ minHeight: '160px' }}
        onClick={handlePlayPause}
        onDoubleClick={handleFullscreen}
      >
        <video
          ref={videoRef}
          src={src}
          className="absolute inset-0 w-full h-full object-contain"
          onLoadedMetadata={() => {
            const video = videoRef.current
            if (video) {
              video.currentTime = startTime
            }
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {!isPlaying && (
            <div className="bg-black/50 rounded-full p-2">
              <Play size={20} className="text-white" />
            </div>
          )}
        </div>
      </div>

      {/* Progress bar - Seekable */}
      <div className="mb-2">
        <div
          className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden cursor-pointer relative"
          onClick={(e) => {
            const video = videoRef.current
            if (!video) return
            const rect = e.currentTarget.getBoundingClientRect()
            const clickX = e.clientX - rect.left
            const percentage = clickX / rect.width
            const seekTime = startTime + (percentage * duration)
            const clampedTime = Math.max(startTime, Math.min(endTime, seekTime))
            video.currentTime = clampedTime
            setCurrentTime(clampedTime - startTime)
          }}
        >
          <div
            className="h-full bg-blue-500 transition-all pointer-events-none"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-0.5">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={handlePlayPause}
          className="flex-1 px-2 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs transition-colors flex items-center justify-center gap-1"
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          <span>{isPlaying ? 'Pause' : 'Play'}</span>
        </button>
        <button
          onClick={handleReset}
          className="px-2 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors flex items-center gap-1"
        >
          <RotateCcw size={14} />
          <span>Reset</span>
        </button>
      </div>
    </div>
  )
}
