import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { submitVideoUrl, getAvailableQualities } from '../api/client'
import { useSessionStore } from '../store/sessionStore'
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
  const [availableQualities, setAvailableQualities] = useState<string[]>(['best', '1080p', '720p', '480p', '360p', 'worst'])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingQualities, setIsLoadingQualities] = useState(false)
  const navigate = useNavigate()
  const { setActiveVideo } = useSessionStore()

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
          if (!qualities.includes(quality)) {
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
      const { jobId, videoId, video } = await submitVideoUrl(url, quality)

      if (video) {
        setActiveVideo(video)
      }

      if (jobId) {
        const { setVideoJobId } = useSessionStore.getState()
        setVideoJobId(videoId, jobId)
      }

      if (jobId) {
        navigate(`/editor/${videoId}`)
      } else {
        navigate(`/editor/${videoId}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit video')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="main-container">
      <div className="main-menubar">
        <span className="main-menu-item">File</span>
        <span className="main-menu-item">Recent</span>
        <span className="main-menu-item">Options</span>
        <span className="main-menu-item">Help</span>
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

          <form onSubmit={handleSubmit} className="main-grid-placeholder">
            <div className="main-section-title">Import Video</div>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste YouTube URL (e.g., https://youtu.be/...)"
              className="main-input main-input-lg"
              disabled={isLoading}
            />

            <div className="main-editbox-row" style={{ marginBottom: 12 }}>
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
                    <option key={q} value={q}>
                      {q === 'best' ? 'Best Quality' : q === 'worst' ? 'Efficiency Mode' : q}
                    </option>
                  ))
                )}
              </select>
            </div>

            {error && (
              <div style={{ background: 'rgba(243,139,168,0.15)', border: '1px solid #f38ba8', color: '#f38ba8', padding: '10px', borderRadius: '4px', fontSize: '13px', marginBottom: '12px' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="main-tbtn main-tbtn-primary main-btn-lg"
              style={{ padding: '12px', fontSize: 15 }}
            >
              {isLoading ? 'Initializing...' : 'Open Video'}
            </button>
          </form>

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
