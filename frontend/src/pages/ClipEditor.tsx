import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Plus, Settings, Download, ChevronDown, FolderOpen, Home, ArrowLeft, FileDown, Edit, X } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import { useVideoMetadata } from '../hooks/useVideoMetadata'
import { useJobProgress } from '../hooks/useJobProgress'
import { getVideoFileUrl, createClip, submitVideoUrl, getAvailableQualities, openVideoFolder, downloadPartial, submitExport, submitExportIndividual, getDownloadUrl, getClipDownloadUrl } from '../api/client'
import { VideoPlayer } from '../components/VideoPlayer'
import { TrimBar } from '../components/TrimBar'
import { ClipTray } from '../components/ClipTray'
import { ClipPreview } from '../components/ClipPreview'
import { Modal } from '../components/Modal'
import { ProgressBar } from '../components/ProgressBar'
import { formatTime, parseTime } from '../types/subtitle'
import { QualityInfo } from '../types'
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
  const [availableQualities, setAvailableQualities] = useState<QualityInfo[]>([
    { label: 'best', size: '', sizeInBytes: 0 },
    { label: '1080p', size: '', sizeInBytes: 0 },
    { label: '720p', size: '', sizeInBytes: 0 },
    { label: '480p', size: '', sizeInBytes: 0 },
    { label: '360p', size: '', sizeInBytes: 0 },
    { label: 'worst', size: '', sizeInBytes: 0 }
  ])
  const [isLoadingQualities, setIsLoadingQualities] = useState(false)
  const [processingClips, setProcessingClips] = useState<Set<string>>(new Set())
  const [isVideoReady, setIsVideoReady] = useState(false)
  const [showClipsPanel] = useState(true)
  const [viewingClip, setViewingClip] = useState<{ start: number; end: number; videoId?: string } | null>(null)
  const [isClipPreviewOpen, setIsClipPreviewOpen] = useState(true)
  const hasRestoredClipRef = useRef(false)

  const [startInput, setStartInput] = useState('')
  const [endInput, setEndInput] = useState('')
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false)
  const [isRemote, setIsRemote] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [partialJobId, setPartialJobId] = useState<string | null>(null)
  const ytPlayerRef = useRef<HTMLIFrameElement>(null)
  const { status: partialStatus, progress: partialProgress } = useJobProgress(partialJobId)
  const isPartialClipMode = !!(sessionStorage.getItem('importMode') === 'clip' && sessionStorage.getItem('videoUrl'))
  const [downloadedClipTimes, setDownloadedClipTimes] = useState<{ start: number; end: number } | null>(null)

  const [showDecisionModal, setShowDecisionModal] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isExportingIndividual, setIsExportingIndividual] = useState(false)
  const [individualJobId, setIndividualJobId] = useState<string | null>(null)
  const { exportJobId, setExportJobId } = useSessionStore()
  const { progress: exportProgress, status: exportStatus, message: exportMessage, error: exportError } = useJobProgress(exportJobId)
  const { progress: individualProgress, status: individualStatus, message: individualMessage, error: individualError } = useJobProgress(individualJobId)

  useEffect(() => {
    setStartInput(formatTime(startTime))
  }, [startTime])

  useEffect(() => {
    setEndInput(formatTime(endTime))
  }, [endTime])

  // Auto-extend end time when start crosses past end
  useEffect(() => {
    if (startTime >= endTime) {
      const maxDuration = activeVideo?.duration || Infinity
      setEndTime(Math.min(startTime + 360, maxDuration))
    }
  }, [startTime, endTime])

  const handleStartBlur = () => {
    const time = parseTime(startInput)
    if (!isNaN(time) && time >= 0 && time <= (activeVideo?.duration || Infinity)) {
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
  const isLive = !!(activeVideo?.isLive || sessionStorage.getItem('isLive') === 'true')

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
      // For live streams, duration might be 0 or very large (elapsed time)
      // Use a reasonable default window if duration is 0/missing
      const effectiveDuration = video.duration > 0 ? video.duration : 86400
      setEndTime(Math.min(30, effectiveDuration))
      setCurrentTime(0)
      hasRestoredClipRef.current = true
    }
  }, [video, videoId])

  useEffect(() => {
    hasRestoredClipRef.current = false
  }, [videoId])

  // When a partial download completes in clip mode, auto-add clip and reset for next selection
  useEffect(() => {
    if (partialStatus === 'done' && isPartialClipMode && downloadedClipTimes && videoId) {
      const clip = {
        id: `clip-${Date.now()}`,
        videoId,
        start: downloadedClipTimes.start,
        end: downloadedClipTimes.end,
        label: `Clip ${clips.length + 1}`,
      }
      addClip(clip)
      setDownloadedClipTimes(null)
      setIsDownloading(false)
      setPartialJobId(null)
    }
  }, [partialStatus, isPartialClipMode, downloadedClipTimes, videoId])

  // Check if the video file exists on disk; if not, it's remote (YouTube preview mode)
  useEffect(() => {
    if (!videoId) {
      setIsVideoReady(false)
      setIsRemote(false)
      return
    }

    setIsVideoReady(false)

    const checkVideoReady = async () => {
      // In partial clip mode, partial download completion doesn't change the UI mode
      if (partialStatus === 'done' && isPartialClipMode) {
        // Stay in clip mode - don't transition to local player
        return
      }

      // Non-clip-mode: partial download transitions to local player
      if (partialStatus === 'done' && !isPartialClipMode) {
        setIsVideoReady(true)
        setIsRemote(false)
        setIsDownloading(false)
        setPartialJobId(null)
        return
      }

      if (downloadJobId && downloadStatus === 'done') {
        setIsVideoReady(true)
        setIsRemote(false)
        return
      }

      if (downloadJobId && downloadStatus === 'error') {
        setIsVideoReady(false)
        return
      }

      // If there's an active download job still processing, don't poll the file endpoint
      // The job progress system (SSE) will handle the state transition when it completes
      if (downloadJobId && downloadStatus && downloadStatus !== 'done') {
        return
      }

      // Same for partial downloads — rely on partialStatus SSE tracking
      if (isDownloading && partialJobId && partialStatus && partialStatus !== 'done') {
        return
      }

      try {
        const response = await fetch(getVideoFileUrl(videoId), { method: 'HEAD' })
        if (response.ok) {
          // In partial clip mode, local file existing doesn't change the UI mode
          if (isPartialClipMode) {
            setIsVideoReady(true)
            // Keep isRemote as-is so the YouTube iframe stays visible
          } else {
            setIsVideoReady(true)
            setIsRemote(false)
          }
        } else {
          setIsVideoReady(false)
          setIsRemote(true)
        }
      } catch (err) {
        setIsVideoReady(false)
        setIsRemote(true)
      }
    }

    checkVideoReady()
    const interval = setInterval(checkVideoReady, 2000)
    return () => clearInterval(interval)
  }, [videoId, downloadJobId, downloadStatus, partialStatus, isPartialClipMode, isDownloading, partialJobId])

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
      setAvailableQualities([
        { label: 'best', size: '', sizeInBytes: 0 },
        { label: '1080p', size: '', sizeInBytes: 0 },
        { label: '720p', size: '', sizeInBytes: 0 },
        { label: '480p', size: '', sizeInBytes: 0 },
        { label: '360p', size: '', sizeInBytes: 0 },
        { label: 'worst', size: '', sizeInBytes: 0 }
      ])

      navigate(`/editor/${newVideoId}`, { replace: false })
    } catch (err) {
      console.error('Failed to add video:', err)
      alert(err instanceof Error ? err.message : 'Failed to add video')
    }
  }

  const handleExportNow = async () => {
    if (clips.length === 0) return
    setIsExporting(true)
    try {
      const { jobId } = await submitExport(clips)
      setExportJobId(jobId)
    } catch (err) {
      console.error('Failed to export:', err)
      setIsExporting(false)
    }
  }

  const handleExportIndividual = async () => {
    if (clips.length === 0) return
    setIsExportingIndividual(true)
    try {
      const { jobId } = await submitExportIndividual(clips)
      setIndividualJobId(jobId)
    } catch (err) {
      console.error('Failed to export individually:', err)
      setIsExportingIndividual(false)
    }
  }

  const handleDownloadAllClips = async () => {
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]
      const link = document.createElement('a')
      link.href = getClipDownloadUrl(clip.id)
      link.download = `${clip.label || `clip-${clip.id}`}.mp4`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      if (i < clips.length - 1) await new Promise(resolve => setTimeout(resolve, 500))
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
            const labels = qualities.map(q => q.label)
            if (!labels.includes(newVideoQuality)) {
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

  const handleOpenFileLocation = async () => {
    if (!activeVideo) return
    try {
      await openVideoFolder(activeVideo.id)
    } catch (err: any) {
      console.error('Failed to open file location:', err)
      alert('Failed to open file location')
    }
    setIsFileMenuOpen(false)
  }

  if (!activeVideo) {
    return (
      <div className="main-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="text-white">Loading video... {videoId}</div>
      </div>
    )
  }

  const videoSrc = getVideoFileUrl(videoId!)
  const youtubeUrl = sessionStorage.getItem('videoUrl') || ''
  const storedQuality = sessionStorage.getItem('videoQuality') || 'best'

  const handleDownloadSelection = useCallback(async () => {
    if (!videoId || !youtubeUrl) return
    setIsDownloading(true)
    setDownloadedClipTimes({ start: startTime, end: endTime })
    try {
      const { jobId } = await downloadPartial(videoId, youtubeUrl, storedQuality, startTime, endTime, isLive)
      if (jobId) {
        setPartialJobId(jobId)
        const { setVideoJobId } = useSessionStore.getState()
        setVideoJobId(videoId, jobId)
      }
    } catch (err) {
      console.error('Failed to start partial download:', err)
      alert(err instanceof Error ? err.message : 'Failed to download')
      setIsDownloading(false)
      setDownloadedClipTimes(null)
    }
  }, [videoId, youtubeUrl, storedQuality, startTime, endTime, isLive])

  return (
    <div className="main-container">
      <div className="main-menubar">
        <div style={{ position: 'relative' }}>
          <span
            className={`main-menu-item ${isFileMenuOpen ? 'active' : ''}`}
            onClick={() => setIsFileMenuOpen(!isFileMenuOpen)}
          >
            File
          </span>
          {isFileMenuOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              background: '#1e1e2e',
              border: '1px solid #313244',
              borderRadius: '4px',
              padding: '4px',
              zIndex: 1000,
              minWidth: '180px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
            }}>
              <button
                style={{
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: '#cdd6f4',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%'
                }}
                className="hover:bg-[#313244]" // Assuming you have tailwind or similar, otherwise I should use onMouseEnter/Leave or a css class.
                onClick={() => {
                  navigate('/')
                  setIsFileMenuOpen(false)
                }}
              >
                <Home size={14} /> Home
              </button>
              <button
                style={{
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: '#cdd6f4',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%'
                }}
                onClick={handleOpenFileLocation}
              >
                <FolderOpen size={14} /> Open file location
              </button>
            </div>
          )}
        </div>
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
        <div style={{ flex: 1 }} />
        {clips.length > 0 && (
          <button className="main-tbtn main-tbtn-primary" onClick={() => setShowDecisionModal(true)}>
            <Download size={14} /> Export Options
          </button>
        )}
      </div>

      <div className="main-top-panel" style={{ height: 'calc(100vh - 120px)' }}>
        <div className="main-video-panel" style={{ minWidth: '800px' }}>
          <div className="main-video-container" style={{ position: 'relative' }}>
            {isPartialClipMode ? (
              <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
                <iframe
                  ref={ytPlayerRef}
                  src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&start=${Math.floor(currentTime)}`}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : isVideoReady ? (
              <VideoPlayer
                src={videoSrc}
                currentTime={currentTime}
                onTimeUpdate={setCurrentTime}
              />
            ) : isRemote && !isDownloading ? (
              <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
                <iframe
                  ref={ytPlayerRef}
                  src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&start=${Math.floor(currentTime)}`}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
                <div style={{ width: 40, height: 40, border: '3px solid #313244', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 13, color: '#a6adc8' }}>
                  {isDownloading
                    ? `Downloading selection... ${partialProgress}%`
                    : `${downloadMessage || 'Loading stream...'} (${downloadProgress}%)`
                  }
                </span>
              </div>
            )}

            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '8px 12px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)', fontSize: 13, fontWeight: 600, color: '#fff', pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
              {isLive && (
                <span style={{ background: '#e64553', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: '0.5px' }}>LIVE</span>
              )}
              {activeVideo.title}
            </div>
          </div>

          <div className="main-video-controls" style={{ padding: '8px', borderBottom: '1px solid #313244' }}>
            <span className="main-video-time">{formatTime(currentTime)}</span>
            <div style={{ flex: 1, margin: '0 12px' }}>
              {(() => {
                const effectiveDuration = activeVideo.duration > 0 ? activeVideo.duration : (isLive ? 86400 : 0)
                return effectiveDuration > 0 ? (
                  <TrimBar
                    duration={effectiveDuration}
                    start={startTime}
                    end={endTime}
                    onStartChange={setStartTime}
                    onEndChange={setEndTime}
                    onSeek={setCurrentTime}
                  />
                ) : null
              })()}
            </div>
            <span className="main-video-time">{isLive && activeVideo.duration <= 0 ? 'LIVE' : formatTime(activeVideo.duration)}</span>
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
                <div className="main-section-title">{isPartialClipMode || (isRemote && !isVideoReady) ? 'Selection Preview' : 'Clip Boundary Preview'}</div>
                <div style={{ flex: 1, background: '#000', borderRadius: 4, overflow: 'hidden', marginBottom: 12, display: 'flex', flexDirection: 'column', minHeight: '240px' }}>
                  {isPartialClipMode ? (
                    <iframe
                      src={`https://www.youtube.com/embed/${videoId}?start=${Math.floor(startTime)}&end=${Math.ceil(endTime)}&rel=0`}
                      style={{ width: '100%', height: '100%', border: 'none' }}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  ) : isVideoReady ? (
                    <ClipPreview src={videoSrc} startTime={startTime} endTime={endTime} />
                  ) : isRemote ? (
                    <iframe
                      src={`https://www.youtube.com/embed/${videoId}?start=${Math.floor(startTime)}&end=${Math.ceil(endTime)}&rel=0`}
                      style={{ width: '100%', height: '100%', border: 'none' }}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#585b70', fontSize: 12 }}>Preview Unavailable</div>
                  )}
                </div>
                {isPartialClipMode ? (
                  <button
                    onClick={handleDownloadSelection}
                    className="main-tbtn main-tbtn-primary"
                    style={{ width: '100%', height: 40, fontSize: 14, fontWeight: 600 }}
                    disabled={isDownloading}
                  >
                    <Download size={16} /> {isDownloading ? `Downloading... ${partialProgress}%` : 'Download Selection'}
                  </button>
                ) : (isRemote && !isVideoReady) ? (
                  <button
                    onClick={handleDownloadSelection}
                    className="main-tbtn main-tbtn-primary"
                    style={{ width: '100%', height: 40, fontSize: 14, fontWeight: 600 }}
                    disabled={isDownloading}
                  >
                    <Download size={16} /> {isDownloading ? `Downloading... ${partialProgress}%` : 'Download Selection'}
                  </button>
                ) : (
                  <button
                    onClick={handleAddClip}
                    className="main-tbtn main-tbtn-primary"
                    style={{ width: '100%', height: 40, fontSize: 14, fontWeight: 600 }}
                  >
                    <Plus size={16} /> Add to Timeline
                  </button>
                )}
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
                  <option key={q.label} value={q.label}>
                    {q.label}
                    {q.size ? ` (${q.size})` : ''}
                  </option>
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

      <Modal
        isOpen={showDecisionModal}
        onClose={() => {
          setShowDecisionModal(false)
          setIsExporting(false)
          setIsExportingIndividual(false)
          setExportJobId(null)
          setIndividualJobId(null)
        }}
        title={isExporting || isExportingIndividual ? "Exporting Clips" : "Export Options"}
      >
        <div style={{ padding: 4 }}>
          {isExporting || isExportingIndividual ? (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-gray-400 mb-2">
                  <span>{(isExporting ? exportMessage : individualMessage) || 'Processing...'}</span>
                  <span className="font-semibold">{isExporting ? exportProgress : individualProgress}%</span>
                </div>
                <ProgressBar progress={isExporting ? exportProgress : individualProgress} />
              </div>

              {(isExporting ? exportError : individualError) && (
                <div className="bg-red-500/20 border border-red-500 text-red-400 px-3 py-2 rounded-lg text-xs">
                  {isExporting ? exportError : individualError}
                </div>
              )}

              {(isExporting ? exportStatus : individualStatus) === 'done' && (
                <button
                  onClick={isExporting ? () => window.location.href = getDownloadUrl(exportJobId!) : handleDownloadAllClips}
                  className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2 text-sm font-semibold"
                >
                  <Download size={16} />
                  {isExporting ? 'Download Merged Video' : 'Download All Clips'}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={handleExportNow}
                className="w-full p-4 bg-[#11111b] border border-[#313244] rounded-lg hover:border-[#89b4fa] transition-all text-left group"
              >
                <div className="flex items-center gap-3 mb-1">
                  <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400 group-hover:bg-blue-500/20">
                    <Download size={18} />
                  </div>
                  <span className="font-semibold text-white">Merge All Clips</span>
                </div>
                <p className="text-xs text-[#a6adc8] ml-11">Combine all extracted clips into a single MP4 file.</p>
              </button>

              <button
                onClick={handleExportIndividual}
                className="w-full p-4 bg-[#11111b] border border-[#313244] rounded-lg hover:border-[#a6e3a1] transition-all text-left group"
              >
                <div className="flex items-center gap-3 mb-1">
                  <div className="p-2 bg-green-500/10 rounded-lg text-green-400 group-hover:bg-green-500/20">
                    <FileDown size={18} />
                  </div>
                  <span className="font-semibold text-white">Batch Export</span>
                </div>
                <p className="text-xs text-[#a6adc8] ml-11">Download each clip as an individual video file.</p>
              </button>

              <button
                onClick={() => navigate('/translate')}
                className="w-full p-4 bg-[#11111b] border border-[#313244] rounded-lg hover:border-[#f9e2af] transition-all text-left group"
              >
                <div className="flex items-center gap-3 mb-1">
                  <div className="p-2 bg-yellow-500/10 rounded-lg text-yellow-400 group-hover:bg-yellow-500/20">
                    <Edit size={18} />
                  </div>
                  <span className="font-semibold text-white">Edit & Translate</span>
                </div>
                <p className="text-xs text-[#a6adc8] ml-11">Open the advanced editor to add subtitles and animations.</p>
              </button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
