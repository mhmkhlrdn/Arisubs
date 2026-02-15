import { useEffect, useState, useRef } from 'react'
import { getVideo } from '../api/client'
import type { Video } from '../types'

export function useVideoMetadata(videoId: string | null): Video | null {
  const [video, setVideo] = useState<Video | null>(null)
  const currentVideoIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!videoId) {
      setVideo(null)
      currentVideoIdRef.current = null
      return
    }

    // Track the current videoId to prevent race conditions
    currentVideoIdRef.current = videoId
    setVideo(null) // Clear previous video while loading

    getVideo(videoId)
      .then((fetchedVideo) => {
        // Only update if this is still the current videoId
        if (currentVideoIdRef.current === videoId && fetchedVideo.id === videoId) {
          setVideo(fetchedVideo)
        }
      })
      .catch((err) => {
        console.error('Failed to load video metadata:', err)
        // Only clear if this is still the current videoId
        if (currentVideoIdRef.current === videoId) {
          setVideo(null)
        }
      })
  }, [videoId])

  return video
}
