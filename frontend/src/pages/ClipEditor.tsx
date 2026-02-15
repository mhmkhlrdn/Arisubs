import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Plus, Settings, Download, ChevronDown } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import { useVideoMetadata } from '../hooks/useVideoMetadata'
import { useJobProgress } from '../hooks/useJobProgress'
import { getVideoFileUrl, createClip, submitVideoUrl, getAvailableQualities } from '../api/client'
import { VideoPlayer } from '../components/VideoPlayer'
import { TrimBar } from '../components/TrimBar'
import { ClipTray } from '../components/ClipTray'
import { ClipPreview } from '../components/ClipPreview'
import { Modal } from '../components/Modal'
import { formatTime, parseTime } from '../types/subtitle'
import '../styles/main.css'

/**
 * COMMENTS & NOTES:
 *
 * [State Management]
 * - Sync inputs when state changes (useEffect dependencies: startTime, endTime)
 * - Get job ID for this video to track download progress
 *
 * [Initialization & Restoration]
 * - Restore viewing clip from sessionStorage on mount
 * - Check both state and sessionStorage for viewing clip
 * - If we have a viewing clip for this video, restore its timestamps
 * - Clear if it's for a different video
 * - Clear after restoring
 * - Separate effect to restore clip timestamps when video loads
 * - Skip if we've already restored for this video
 * - Only set defaults if we don't have a viewing clip waiting
 * - Mark as processed to prevent re-running
 * - Reset the restoration flag when videoId changes
 * - Only update if the video ID matches the current videoId to prevent race conditions
 * - Reset video ready state when switching videos
 *
 * [Video Readiness]
 * - Check if video file is ready - check both file existence and job status
 * - Reset state when videoId changes
 * - If download job is done, file should be ready
 * - If download job has error, mark as not ready
 * - Otherwise, check file existence
 * - Poll every 2 seconds to check if video becomes ready
 *
 * [Clip Handling]
 * - If the clip is from a different video, navigate to that video's editor
 * - Store the clip in sessionStorage to persist across navigation
 * - Same video, just update timestamps
 * - Open the clip preview panel if it's collapsed
 * - Validate start and end times
 * - If video isn't ready, show message but still allow clip creation
 * - Poll job status
 * - Cleanup after 60 seconds
 * - If error is about video not ready, show friendly message
 *
 * [Video Import]
 * - Store video metadata immediately if available
 * - Store job ID for tracking download progress
 * - Switch to the new video without navigating away - just update the URL param
 *
 */

export function ClipEditor() {
  const { videoId } = useParams<{ videoId: string }>()
  const navigate = useNavigate()
  const { videos, clips, setActiveVideo, addClip, videoJobIds } = useSessionStore()
  const video = useVideoMetadata(videoId || null)
  const [startTime, setStartTime] = useState(0)
  const [endTime, setEndTime] = useState(10)
  const [currentTime, setCurrentTime] = useState(0)
  const [isAddingVideo, setIsAddingVideo] = useState(false)
  const [newVideoUrl, setNewVideoUrl] = useState('')
  const [newVideoQuality, setNewVideoQuality] = useState('best')
  const [availableQualities, setAvailableQualities] = useState<string[]>(['best', '1080p', '720p', '480p', '360p', 'worst'])
  const [isLoadingQualities, setIsLoadingQualities] = useState(false)
  const [processingClips, setProcessingClips] = useState<Set<string>>(new Set())
  const [isVideoReady, setIsVideoReady] = useState(false)
  const [showClipsPanel, setShowClipsPanel] = useState(true)
  const [viewingClip, setViewingClip] = useState<{ start: number; end: number; videoId?: string } | null>(null)
  const [isClipPreviewOpen, setIsClipPreviewOpen] = useState(true)
  const hasRestoredClipRef = useRef(false)

  const [startInput, setStartInput] = useState('')
  const [endInput, setEndInput] = useState('')

  useEffect(() => {
    setStartInput(formatTime(startTime))
  }, [startTime])

  useEffect(() => {
    setEndInput(formatTime(endTime))
  }, [endTime])

  const handleStartBlur = () => {
    const time = parseTime(startInput)
    if (!isNaN(time) && time >= 0 && time < endTime) {
      setStartTime(time)
    } else {
      setStartInput(formatTime(startTime))
    }
  }

  const handleEndBlur = () => {
    const time = parseTime(endInput)
    if (!isNaN(time) && time > startTime && time <= (activeVideo?.duration || Infinity)) {
      setEndTime(time)
    } else {
      setEndInput(formatTime(endTime))
    }
  }

  const downloadJobId = videoId && videoJobIds[videoId] ? videoJobIds[videoId] : null
  const { status: downloadStatus, progress: downloadProgress, message: downloadMessage } = useJobProgress(downloadJobId)

  const activeVideo = videoId ? videos[videoId] || video : null

  useEffect(() => {
    const storedClip = sessionStorage.getItem('viewingClip')
    if (storedClip) {
      try {
        const clip = JSON.parse(storedClip)
        if (clip.videoId === videoId) {
          setViewingClip(clip)
        } else {
          sessionStorage.removeItem('viewingClip')
        }
      } catch (err) {
        console.error('Failed to parse stored viewing clip:', err)
        sessionStorage.removeItem('viewingClip')
      }
    }
  }, [videoId])

  useEffect(() => {
    if (video && videoId && video.id === videoId) {
      setActiveVideo(video)
      setIsVideoReady(false)
    }
  }, [video, videoId, setActiveVideo])

  useEffect(() => {
    if (!video || !videoId || video.id !== videoId) {
      hasRestoredClipRef.current = false
      return
    }

    if (hasRestoredClipRef.current) {
      return
    }

    const storedClip = sessionStorage.getItem('viewingClip')
    let clipToRestore = viewingClip
    if (!clipToRestore && storedClip) {
      try {
        clipToRestore = JSON.parse(storedClip)
      } catch (err) {
        console.error('Failed to parse stored viewing clip:', err)
      }
    }

    if (clipToRestore && clipToRestore.videoId === videoId) {
      setStartTime(clipToRestore.start)
      setEndTime(clipToRestore.end)
      setCurrentTime(clipToRestore.start)
      hasRestoredClipRef.current = true
      setViewingClip(null)
      sessionStorage.removeItem('viewingClip')
      return
    }

    if (!clipToRestore) {
      setStartTime(0)
      setEndTime(Math.min(30, video.duration))
      setCurrentTime(0)
      hasRestoredClipRef.current = true
    }
  }, [video, videoId])

  useEffect(() => {
    hasRestoredClipRef.current = false
  }, [videoId])

  useEffect(() => {
    if (!videoId) {
      setIsVideoReady(false)
      return
    }

    setIsVideoReady(false)

    const checkVideoReady = async () => {
      if (downloadJobId && downloadStatus === 'done') {
        setIsVideoReady(true)
        return
      }

      if (downloadJobId && downloadStatus === 'error') {
        setIsVideoReady(false)
        return
      }

      try {
        const response = await fetch(getVideoFileUrl(videoId), { method: 'HEAD' })
        setIsVideoReady(response.ok)
      } catch (err) {
        setIsVideoReady(false)
      }
    }

    checkVideoReady()
    const interval = setInterval(checkVideoReady, 2000)
    return () => clearInterval(interval)
  }, [videoId, downloadJobId, downloadStatus])

  const handleViewClip = (clip: { videoId: string; start: number; end: number }) => {
    if (clip.videoId !== videoId) {
      sessionStorage.setItem('viewingClip', JSON.stringify(clip))
      setViewingClip(clip)
      navigate(`/editor/${clip.videoId}`, { replace: false })
    } else {
      setStartTime(clip.start)
      setEndTime(clip.end)
      setCurrentTime(clip.start)
      setViewingClip(null)
      sessionStorage.removeItem('viewingClip')
    }

    if (!isClipPreviewOpen) {
      setIsClipPreviewOpen(true)
    }
  }

  const handleAddClip = async () => {
    if (!videoId || !activeVideo) {
      console.error('Cannot add clip: videoId or activeVideo is missing', { videoId, activeVideo })
      return
    }

    if (isNaN(startTime) || isNaN(endTime) || startTime < 0 || endTime <= startTime) {
      alert('Invalid clip times. Please set valid start and end times.')
      return
    }

    if (!isVideoReady) {
      alert('Video is still downloading. The clip will be created automatically once the download completes.')
    }

    try {
      const clipData = {
        videoId,
        start: Number(startTime),
        end: Number(endTime),
        label: `Clip ${clips.length + 1}`,
      }
      console.log('Creating clip with data:', clipData)
      const { clipId, jobId } = await createClip(clipData)

      const clip = {
        id: clipId,
        videoId,
        start: startTime,
        end: endTime,
        label: `Clip ${clips.length + 1}`,
      }

      addClip(clip)
      setProcessingClips((prev) => new Set(prev).add(clipId))

      const pollInterval = setInterval(async () => {
        try {
          const { getJobState } = await import('../api/client')
          const state = await getJobState(jobId)
          if (state.status === 'done' || state.status === 'error') {
            setProcessingClips((prev) => {
              const next = new Set(prev)
              next.delete(clipId)
              return next
            })
            clearInterval(pollInterval)
          }
        } catch (err) {
          console.error('Failed to check job status:', err)
        }
      }, 1000)

      setTimeout(() => clearInterval(pollInterval), 60000)
    } catch (err: any) {
      console.error('Failed to create clip:', err)
      if (err.message?.includes('not ready')) {
        alert('Video is still downloading. Please wait a moment and try again.')
      } else {
        alert(err.message || 'Failed to create clip')
      }
    }
  }

  const handleAddAnotherVideo = async () => {
    if (!newVideoUrl.trim()) return

    try {
      const { jobId, videoId: newVideoId, video } = await submitVideoUrl(newVideoUrl, newVideoQuality)

      if (video) {
        setActiveVideo(video)
      }

      if (jobId) {
        const { setVideoJobId } = useSessionStore.getState()
        setVideoJobId(newVideoId, jobId)
      }

      setIsAddingVideo(false)
      setNewVideoUrl('')
      setNewVideoQuality('best')
      setAvailableQualities(['best', '1080p', '720p', '480p', '360p', 'worst'])

      navigate(`/editor/${newVideoId}`, { replace: false })
    } catch (err) {
      console.error('Failed to add video:', err)
      alert(err instanceof Error ? err.message : 'Failed to add video')
    }
  }

  const handleUrlChange = (newUrl: string) => {
    setNewVideoUrl(newUrl)
    if (newUrl.trim()) {
      const patterns = [
        /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /^https?:\/\/(www\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
        /^https?:\/\/(www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
        /^https?:\/\/(www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
      ]
      if (patterns.some((pattern) => pattern.test(newUrl))) {
        setIsLoadingQualities(true)
        getAvailableQualities(newUrl)
          .then((qualities) => {
            setAvailableQualities(qualities)
            if (!qualities.includes(newVideoQuality)) {
              setNewVideoQuality('best')
            }
          })
          .catch((err) => {
            console.error('Failed to fetch qualities:', err)
          })
          .finally(() => {
            setIsLoadingQualities(false)
          })
      }
    }
  }

  if (!activeVideo) {
    return (
      <div className="main-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="text-white">Loading video... {videoId}</div>
      </div>
    )
  }

  const videoSrc = getVideoFileUrl(videoId!)

  return (
    <div className="main-container">
      <div className="main-menubar">
        <span className="main-menu-item" onClick={() => navigate('/')}>File</span>
        <span className="main-menu-item" onClick={() => navigate('/translate')}>Edit</span>
        <span className="main-menu-item">Video</span>
        <span className="main-menu-item">Clips</span>
        <span className="main-menu-item">Help</span>
      </div>

      <div className="main-main-toolbar">
        <button className="main-tbtn" title="Add another video" onClick={() => setIsAddingVideo(true)}>
          <Plus size={14} /> Add Video
        </button>
        <div className="main-editbox-separator" />
        <div className="main-editbox-control" style={{ gap: 6 }}>
          <span className="main-label">Active Stream:</span>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <select
              className="main-select"
              style={{ paddingRight: 24, minWidth: 200 }}
              value={videoId}
              onChange={(e) => navigate(`/editor/${e.target.value}`)}
            >
              {Object.values(videos).map(v => (
                <option key={v.id} value={v.id}>
                  {v.title || `Video ${v.id.substring(0, 8)}`}
                </option>
              ))}
            </select>
            <ChevronDown size={12} style={{ position: 'absolute', right: 8, color: '#6c7086', pointerEvents: 'none' }} />
          </div>
        </div>
        <div className="main-editbox-separator" />
        <button
          className={`main-tbtn ${showClipsPanel ? 'main-tbtn-active' : ''}`}
          onClick={() => setShowClipsPanel(!showClipsPanel)}
        >
          <Settings size={14} /> Clips Panel
        </button>
        <div style={{ flex: 1 }} />
        {clips.length > 0 && (
          <button className="main-tbtn main-tbtn-primary" onClick={() => navigate('/decision')}>
            <Download size={14} /> Export Options
          </button>
        )}
      </div>

      <div className="main-top-panel" style={{ height: 'calc(100vh - 120px)' }}>
        <div className="main-video-panel" style={{ minWidth: '800px' }}>
          <div className="main-video-container" style={{ position: 'relative' }}>
            {isVideoReady ? (
              <VideoPlayer
                src={videoSrc}
                currentTime={currentTime}
                onTimeUpdate={setCurrentTime}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
                <div style={{ width: 40, height: 40, border: '3px solid #313244', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 13, color: '#a6adc8' }}>{downloadMessage || 'Loading stream...'} ({downloadProgress}%)</span>
              </div>
            )}

            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '8px 12px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)', fontSize: 13, fontWeight: 600, color: '#fff', pointerEvents: 'none' }}>
              {activeVideo.title}
            </div>
          </div>

          <div className="main-video-controls" style={{ padding: '8px', borderBottom: '1px solid #313244' }}>
            <span className="main-video-time">{formatTime(currentTime)}</span>
            <div style={{ flex: 1, margin: '0 12px' }}>
              {activeVideo.duration > 0 && (
                <TrimBar
                  duration={activeVideo.duration}
                  start={startTime}
                  end={endTime}
                  onStartChange={setStartTime}
                  onEndChange={setEndTime}
                  onSeek={setCurrentTime}
                />
              )}
            </div>
            <span className="main-video-time">{formatTime(activeVideo.duration)}</span>
          </div>

          <div className="main-audio-toolbar" style={{ height: 32, justifyContent: 'center', gap: 16 }}>
            <div className="main-editbox-control">
              <span className="main-label">Start:</span>
              <input
                className="main-input main-input-time"
                value={startInput}
                onChange={e => setStartInput(e.target.value)}
                onBlur={handleStartBlur}
                onKeyDown={e => e.key === 'Enter' && handleStartBlur()}
              />
            </div>
            <div className="main-editbox-control">
              <span className="main-label">End:</span>
              <input
                className="main-input main-input-time"
                value={endInput}
                onChange={e => setEndInput(e.target.value)}
                onBlur={handleEndBlur}
                onKeyDown={e => e.key === 'Enter' && handleEndBlur()}
              />
            </div>
            <div className="main-editbox-control">
              <span className="main-label">Duration:</span>
              <span className="main-video-time" style={{ color: '#89b4fa', fontWeight: 600 }}>{formatTime(endTime - startTime)}</span>
            </div>
          </div>
        </div>

        <div className="main-audio-panel" style={{ borderLeft: '1px solid #313244', display: 'flex', flexDirection: 'column', minWidth: '360px' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #313244' }}>
            <button className={`main-tbtn ${isClipPreviewOpen ? 'main-tbtn-active' : ''}`} style={{ flex: 1, borderRadius: 0, height: 32 }} onClick={() => setIsClipPreviewOpen(true)}>Preview</button>
            <button className={`main-tbtn ${!isClipPreviewOpen ? 'main-tbtn-active' : ''}`} style={{ flex: 1, borderRadius: 0, height: 32 }} onClick={() => setIsClipPreviewOpen(false)}>Clips ({clips.length})</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
            {isClipPreviewOpen ? (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div className="main-section-title">Clip Boundary Preview</div>
                <div style={{ flex: 1, background: '#000', borderRadius: 4, overflow: 'hidden', marginBottom: 12, display: 'flex', flexDirection: 'column', minHeight: '240px' }}>
                  {isVideoReady ? (
                    <ClipPreview src={videoSrc} startTime={startTime} endTime={endTime} />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#585b70', fontSize: 12 }}>Preview Unavailable</div>
                  )}
                </div>
                <button
                  onClick={handleAddClip}
                  className="main-tbtn main-tbtn-primary"
                  style={{ width: '100%', height: 40, fontSize: 14, fontWeight: 600 }}
                >
                  <Plus size={16} /> Add to Timeline
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div className="main-section-title" style={{ marginBottom: 8 }}>Collected Clips ({clips.length})</div>
                <div style={{ flex: 1 }}>
                  <ClipTray
                    clips={clips}
                    processingClips={processingClips}
                    onViewClip={handleViewClip}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="main-statusbar">
        <div className="main-statusbar-section">
          <span>Video: {activeVideo.id}</span>
          <span>FPS: 30.00</span>
        </div>
        <div className="main-statusbar-section">
          <span>Range: {formatTime(startTime)} - {formatTime(endTime)} ({formatTime(endTime - startTime)})</span>
        </div>
      </div>

      <Modal
        isOpen={isAddingVideo}
        onClose={() => { setIsAddingVideo(false); setNewVideoUrl(''); setNewVideoQuality('best') }}
        title="Import Another Stream"
      >
        <div className="main-grid-placeholder" style={{ padding: 8 }}>
          <div className="main-section-title">Video URL</div>
          <input
            type="text"
            value={newVideoUrl}
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder="Paste YouTube Link"
            className="main-input"
            style={{ marginBottom: 16 }}
          />
          <div className="main-editbox-row" style={{ marginBottom: 16 }}>
            <span className="main-label">Quality:</span>
            <select
              value={newVideoQuality}
              onChange={(e) => setNewVideoQuality(e.target.value)}
              className="main-select"
              style={{ flex: 1 }}
              disabled={isLoadingQualities}
            >
              {isLoadingQualities ? (
                <option value="best">Detecting...</option>
              ) : (
                availableQualities.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))
              )}
            </select>
          </div>
          <button
            onClick={handleAddAnotherVideo}
            className="main-tbtn main-tbtn-primary"
            style={{ height: 36, fontWeight: 600 }}
          >
            Load Stream
          </button>
        </div>
      </Modal>
    </div>
  )
}
