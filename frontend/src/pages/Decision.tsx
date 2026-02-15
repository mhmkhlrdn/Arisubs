import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { ArrowLeft, Download, Edit, X, FileDown } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import { submitExport, submitExportIndividual, getDownloadUrl, getClipDownloadUrl } from '../api/client'
import { useJobProgress } from '../hooks/useJobProgress'
import { ProgressBar } from '../components/ProgressBar'
import '../styles/main.css'

/**
 * [handleDownloadAllClips]
 * - Download each clip individually with delays to prevent browser blocking
 * - Add delay between downloads (except for the last one)
 *
 * [JXS Rendering]
 * - Menu Bar
 * - Combined Export
 * - Individual Export
 */

export function Decision() {
  const navigate = useNavigate()
  const { clips, setExportJobId, exportJobId } = useSessionStore()
  const [isExporting, setIsExporting] = useState(false)
  const [isExportingIndividual, setIsExportingIndividual] = useState(false)
  const [individualJobId, setIndividualJobId] = useState<string | null>(null)
  const { progress, status, message, error } = useJobProgress(exportJobId)
  const { progress: individualProgress, status: individualStatus, message: individualMessage, error: individualError } = useJobProgress(individualJobId)

  const totalDuration = clips.reduce((sum, clip) => sum + (clip.end - clip.start), 0)

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)

    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`
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

  const handleDownload = () => {
    if (exportJobId && status === 'done') {
      window.location.href = getDownloadUrl(exportJobId)
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

      if (i < clips.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
  }

  if ((isExporting && exportJobId) || (isExportingIndividual && individualJobId)) {
    const currentProgress = isExporting ? progress : individualProgress
    const currentStatus = isExporting ? status : individualStatus
    const currentMessage = isExporting ? message : individualMessage
    const currentError = isExporting ? error : individualError
    return (
      <div className="main-container">
        <div className="flex-shrink-0 px-4 py-3 bg-gray-800 border-b border-gray-700">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold">Exporting</h1>
            <button
              onClick={() => {
                setIsExporting(false)
                setIsExportingIndividual(false)
                setExportJobId(null)
                setIndividualJobId(null)
              }}
              className="p-1 hover:bg-gray-700 rounded transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-gray-800 rounded-lg p-6">
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm text-gray-400 mb-2">
                  <span>{currentMessage || 'Processing...'}</span>
                  <span className="font-semibold">{currentProgress}%</span>
                </div>
                <ProgressBar progress={currentProgress} />
              </div>

              {currentError && (
                <div className="bg-red-500/20 border border-red-500 text-red-400 px-3 py-2 rounded-lg text-sm">
                  {currentError}
                </div>
              )}

              {currentStatus === 'done' && (
                <>
                  {isExportingIndividual ? (
                    <button
                      onClick={handleDownloadAllClips}
                      className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      <FileDown size={18} />
                      Download All Clips ({clips.length})
                    </button>
                  ) : (
                    <button
                      onClick={handleDownload}
                      className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      <Download size={18} />
                      Download Export
                    </button>
                  )}
                </>
              )}

              {currentStatus === 'error' && (
                <button
                  onClick={() => {
                    setIsExporting(false)
                    setIsExportingIndividual(false)
                    setExportJobId(null)
                    setIndividualJobId(null)
                  }}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  Go Back
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="main-container" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="main-menubar">
        <span className="main-menu-item" onClick={() => navigate('/editor')}>File</span>
        <span className="main-menu-item" onClick={() => navigate('/translate')}>Translate</span>
        <span className="main-menu-item">Help</span>
      </div>

      <div className="main-landing" style={{ flex: 1 }}>
        <div className="main-card" style={{ maxWidth: 800 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <button
              onClick={() => navigate(-1)}
              className="main-tbtn"
              style={{ width: 28, height: 28 }}
            >
              <ArrowLeft size={14} />
            </button>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#fff' }}>Post-Extraction Actions</h1>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <div style={{ background: '#11111b', border: '1px solid #313244', padding: 20, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ padding: 8, background: 'rgba(137,180,250,0.1)', borderRadius: 6, color: '#89b4fa' }}>
                  <Download size={20} />
                </div>
                <span style={{ fontWeight: 600, fontSize: 15 }}>Combined File</span>
              </div>
              <p style={{ fontSize: 12, color: '#a6adc8', margin: 0, lineHeight: 1.5 }}>
                Merge all extracted clips into a single video file.
              </p>
              <button
                onClick={handleExportNow}
                disabled={clips.length === 0}
                className="main-tbtn main-tbtn-primary"
                style={{ marginTop: 'auto', height: 32 }}
              >
                Start Merging
              </button>
            </div>

            <div style={{ background: '#11111b', border: '1px solid #313244', padding: 20, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ padding: 8, background: 'rgba(166,227,161,0.1)', borderRadius: 6, color: '#a6e3a1' }}>
                  <FileDown size={20} />
                </div>
                <span style={{ fontWeight: 600, fontSize: 15 }}>Batch Clips</span>
              </div>
              <p style={{ fontSize: 12, color: '#a6adc8', margin: 0, lineHeight: 1.5 }}>
                Export each clip as an individual MP4 file.
              </p>
              <button
                onClick={handleExportIndividual}
                disabled={clips.length === 0}
                className="main-tbtn main-tbtn-primary"
                style={{ marginTop: 'auto', height: 32, background: '#a6e3a1', color: '#11111b' }}
              >
                Batch Export
              </button>
            </div>

            <div style={{ background: '#11111b', border: '1px solid #313244', padding: 20, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ padding: 8, background: 'rgba(249,226,175,0.1)', borderRadius: 6, color: '#f9e2af' }}>
                  <Edit size={20} />
                </div>
                <span style={{ fontWeight: 600, fontSize: 15 }}>Edit Clips</span>
              </div>
              <p style={{ fontSize: 12, color: '#a6adc8', margin: 0, lineHeight: 1.5 }}>
                Open the editor to add subtitles and translations.
              </p>
              <button
                onClick={() => navigate('/translate')}
                className="main-tbtn main-tbtn-primary"
                style={{ marginTop: 'auto', height: 32, background: '#f9e2af', color: '#11111b' }}
              >
                Open Editor
              </button>
            </div>
          </div>

          <div style={{ marginTop: 24, padding: 16, background: '#1e1e2e', border: '1px solid #313244', borderRadius: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#bac2de' }}>
              <span>Total Clips: {clips.length}</span>
              <span>Total Duration: {formatTime(totalDuration)}</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

