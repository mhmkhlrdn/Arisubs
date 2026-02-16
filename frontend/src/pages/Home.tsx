import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { submitVideoUrl, getAvailableQualities, uploadVideo, listVideos } from '../api/client'
import { useSessionStore } from '../store/sessionStore'
import { Upload, Youtube, Play, Download, Scissors } from 'lucide-react'
import type { Video, QualityInfo } from '../types'
import '../styles/main.css'

/**
 * COMMENTS & NOTES:
 *
 * [Initialization]
 * - Fetch available qualities when URL changes
 * - Reset quality to best if current selection is not available
 * - Keep default qualities on error
 *
 * [Submission]
 * - Store video metadata immediately if available
 * - Store job ID for tracking download progress
 *
 * [UI]
 * - Menu Bar
 */

export function Home() {
  const [url, setUrl] = useState('')
  const [quality, setQuality] = useState('best')
  const [availableQualities, setAvailableQualities] = useState<QualityInfo[]>([
    { label: 'best', size: '', sizeInBytes: 0 },
    { label: '1080p', size: '', sizeInBytes: 0 },
    { label: '720p', size: '', sizeInBytes: 0 },
    { label: '480p', size: '', sizeInBytes: 0 },
    { label: '360p', size: '', sizeInBytes: 0 },
    { label: 'worst', size: '', sizeInBytes: 0 }
  ])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingQualities, setIsLoadingQualities] = useState(false)
  const [activeTab, setActiveTab] = useState<'youtube' | 'local'>('youtube')
  const [isRecentMenuOpen, setIsRecentMenuOpen] = useState(false)
  const [recentVideos, setRecentVideos] = useState<Video[]>([])
  const [importMode, setImportMode] = useState<'download' | 'clip'>('clip')
  const navigate = useNavigate()
  const { setActiveVideo, setVideoJobId } = useSessionStore()

  const validateYouTubeUrl = (url: string): boolean => {
    const patterns = [
      /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      /^https?:\/\/(www\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
      /^https?:\/\/(www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
      /^https?:\/\/(www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    ]
    return patterns.some((pattern) => pattern.test(url))
  }

  useEffect(() => {
    if (url.trim() && validateYouTubeUrl(url)) {
      setIsLoadingQualities(true)
      getAvailableQualities(url)
        .then((qualities) => {
          setAvailableQualities(qualities)
          const labels = qualities.map(q => q.label)
          if (!labels.includes(quality)) {
            setQuality('best')
          }
        })
        .catch((err) => {
          console.error('Failed to fetch qualities:', err)
        })
        .finally(() => {
          setIsLoadingQualities(false)
        })
    }
  }, [url])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!url.trim()) {
      setError('Please enter a YouTube URL')
      return
    }

    if (!validateYouTubeUrl(url)) {
      setError('Invalid YouTube URL')
      return
    }

    setIsLoading(true)

    try {
      const { jobId, videoId, video } = await submitVideoUrl(url, quality, importMode === 'clip')

      if (video) {
        setActiveVideo(video)
      }

      if (jobId) {
        setVideoJobId(videoId, jobId)
      }

      // Store URL, quality, and mode in sessionStorage so ClipEditor can use them
      sessionStorage.setItem('videoUrl', url)
      sessionStorage.setItem('videoQuality', quality)
      sessionStorage.setItem('importMode', importMode)

      navigate(`/editor/${videoId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit video')
    } finally {
      setIsLoading(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('video/')) {
      setError('Please select a valid video file')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const { videoId, video } = await uploadVideo(file)
      setActiveVideo(video)
      navigate(`/editor/${videoId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload video')
    } finally {
      setIsLoading(false)
    }
  }

  const toggleRecentMenu = async () => {
    if (!isRecentMenuOpen) {
      try {
        const videos = await listVideos()
        setRecentVideos(videos)
      } catch (err) {
        console.error('Failed to fetch recent videos:', err)
      }
    }
    setIsRecentMenuOpen(!isRecentMenuOpen)
  }

  const handleRecentClick = (video: Video) => {
    setActiveVideo(video)
    navigate(`/editor/${video.id}`)
    setIsRecentMenuOpen(false)
  }

  return (
    <div className="main-container">
      <div className="main-menubar">
        <div style={{ position: 'relative' }}>
          <span
            className={`main-menu-item ${isRecentMenuOpen ? 'active' : ''}`}
            onClick={toggleRecentMenu}
          >
            Recent
          </span>
          {isRecentMenuOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              background: '#1e1e2e',
              border: '1px solid #313244',
              borderRadius: '4px',
              padding: '4px',
              zIndex: 1000,
              minWidth: '240px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
              maxHeight: '400px',
              overflowY: 'auto'
            }}>
              <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#585b70', borderBottom: '1px solid #313244', marginBottom: 4 }}>
                RECENT VIDEOS
              </div>
              {recentVideos.length === 0 ? (
                <div style={{ padding: '12px', fontSize: 12, color: '#6c7086', textAlign: 'center' }}>
                  No recent videos
                </div>
              ) : (
                recentVideos.map((video) => (
                  <button
                    key={video.id}
                    style={{
                      textAlign: 'left',
                      background: 'transparent',
                      border: 'none',
                      color: '#cdd6f4',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      width: '100%',
                      borderRadius: '2px'
                    }}
                    className="hover:bg-[#313244]"
                    onClick={() => handleRecentClick(video)}
                  >
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                      {video.title || `Video ${video.id}`}
                    </div>
                    <div style={{ fontSize: 11, color: '#6c7086', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Play size={10} /> {video.id}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="main-landing">
        <motion.div
          className="main-card"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <h1 className="main-hero-title">
            Arisubs
          </h1>

          <div className="main-grid-placeholder">
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, borderBottom: '1px solid #313244', paddingBottom: 12 }}>
              <button
                className={`main-tbtn ${activeTab === 'youtube' ? 'main-tbtn-active' : ''}`}
                style={{ flex: 1, height: 36 }}
                onClick={() => setActiveTab('youtube')}
              >
                <Youtube size={16} /> YouTube
              </button>
              <button
                className={`main-tbtn ${activeTab === 'local' ? 'main-tbtn-active' : ''}`}
                style={{ flex: 1, height: 36 }}
                onClick={() => setActiveTab('local')}
              >
                <Upload size={16} /> Local File
              </button>
            </div>

            {activeTab === 'youtube' ? (
              <form onSubmit={handleSubmit}>
                <div className="main-section-title">Import Video</div>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste YouTube URL (e.g., https://youtu.be/...)"
                  className="main-input main-input-lg"
                  disabled={isLoading}
                  style={{ marginBottom: 16 }}
                />

                <div className="main-section-title">Import Method</div>
                <div className="main-mode-selector">
                  <div
                    className={`main-mode-card ${importMode === 'download' ? 'active' : ''}`}
                    onClick={() => setImportMode('download')}
                  >
                    <Download size={20} color={importMode === 'download' ? '#89b4fa' : '#6c7086'} />
                    <div className="main-mode-card-title">Download Full</div>
                    <div className="main-mode-card-desc">Download entire video first. Best for long sessions.</div>
                  </div>
                  <div
                    className={`main-mode-card ${importMode === 'clip' ? 'active' : ''}`}
                    onClick={() => setImportMode('clip')}
                  >
                    <Scissors size={20} color={importMode === 'clip' ? '#89b4fa' : '#6c7086'} />
                    <div className="main-mode-card-title">Partial Clip</div>
                    <div className="main-mode-card-desc">Preview first, download only selected range. Fast & efficient.</div>
                  </div>
                </div>

                <div className="main-editbox-row" style={{ marginBottom: 16 }}>
                  <span className="main-label" style={{ fontSize: 13 }}>Quality:</span>
                  <select
                    value={quality}
                    onChange={(e) => setQuality(e.target.value)}
                    className="main-select"
                    style={{ height: 32, fontSize: 13, flex: 1 }}
                    disabled={isLoading || isLoadingQualities}
                  >
                    {isLoadingQualities ? (
                      <option value="best">Detecting streams...</option>
                    ) : (
                      availableQualities.map((q) => (
                        <option key={q.label} value={q.label}>
                          {q.label === 'best' ? 'Best Quality' : q.label === 'worst' ? 'Efficiency Mode' : q.label}
                          {q.size ? ` (${q.size})` : ''}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {error && activeTab === 'youtube' && (
                  <div style={{ background: 'rgba(243,139,168,0.15)', border: '1px solid #f38ba8', color: '#f38ba8', padding: '10px', borderRadius: '4px', fontSize: '13px', marginBottom: '12px' }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="main-tbtn main-tbtn-primary main-btn-lg"
                  style={{ padding: '12px', fontSize: 15, width: '100%' }}
                >
                  {isLoading ? 'Initializing...' : 'Open Video'}
                </button>
              </form>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div className="main-section-title" style={{ marginBottom: 20 }}>Upload local MP4</div>
                <label className="main-tbtn main-tbtn-primary main-btn-lg" style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  height: 120,
                  cursor: 'pointer',
                  border: '2px dashed #313244',
                  background: 'rgba(49, 50, 68, 0.2)',
                  fontSize: 16
                }}>
                  <Upload size={32} />
                  <span>{isLoading ? 'Uploading...' : 'Click to select file'}</span>
                  <input
                    type="file"
                    accept="video/mp4,video/x-m4v,video/*"
                    onChange={handleFileUpload}
                    className="hidden"
                    disabled={isLoading}
                    style={{ display: 'none' }}
                  />
                </label>
                {error && activeTab === 'local' && (
                  <div style={{ background: 'rgba(243,139,168,0.15)', border: '1px solid #f38ba8', color: '#f38ba8', padding: '10px', borderRadius: '4px', fontSize: '13px', marginTop: '12px' }}>
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ marginTop: 24, fontSize: 11, color: '#585b70', textAlign: 'center' }}>
            Version 1.0.0
          </div>
        </motion.div>
      </div>

      <div className="main-statusbar">
        <div className="main-statusbar-section">
          <span>Ready</span>
        </div>
        <div className="main-statusbar-section">
          <span>{isLoadingQualities ? 'Probing URL...' : 'Idle'}</span>
        </div>
      </div>
    </div>
  )
}
