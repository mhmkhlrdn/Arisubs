import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useJobProgress } from '../hooks/useJobProgress'
import { ProgressBar } from '../components/ProgressBar'
import { Layout } from '../components/Layout'

export function Processing() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const { progress, status, message, output, error } = useJobProgress(jobId || null)

  useEffect(() => {
    if (status === 'done' && output) {
      // Extract videoId from output (could be a path or just the ID)
      let videoId = output
      
      // If output is a file path, extract the video ID from the filename
      if (output.includes('/') || output.includes('\\')) {
        // Extract filename without extension
        const filename = output.split(/[/\\]/).pop() || ''
        videoId = filename.replace(/\.(mp4|webm|mkv)$/i, '')
      }
      
      // Remove any leading/trailing whitespace
      videoId = videoId.trim()
      
      if (videoId) {
        setTimeout(() => {
          navigate(`/editor/${videoId}`)
        }, 1000)
      }
    }
  }, [status, output, navigate])

  // Allow user to navigate to editor while downloading
  // Extract videoId from URL or use a placeholder - we'll get it from the job
  const handleGoToEditor = () => {
    // Try to get videoId from the current URL or job output
    // If we have output, use it; otherwise we need to get it from the job state
    if (output) {
      let videoId = output.trim()
      if (output.includes('/') || output.includes('\\')) {
        const filename = output.split(/[/\\]/).pop() || ''
        videoId = filename.replace(/\.(mp4|webm|mkv)$/i, '')
      }
      if (videoId) {
        navigate(`/editor/${videoId}`)
        return
      }
    }
    // If no output yet, we can't navigate - show message
    alert('Video ID not available yet. Please wait a moment.')
  }

  return (
    <Layout showSteps={true}>
      <div className="flex items-center justify-center p-4 flex-1">
        <motion.div
          className="w-full max-w-md bg-gray-800 rounded-lg p-8"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
        >
        <h2 className="text-2xl font-bold text-white mb-6">Processing Video</h2>

        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm text-gray-400 mb-2">
              <span>{message || 'Processing...'}</span>
              <span>{progress}%</span>
            </div>
            <ProgressBar progress={progress} />
          </div>

          {error && (
            <div className="bg-red-500/20 border border-red-500 text-red-400 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {status === 'processing' && (
            <button
              onClick={handleGoToEditor}
              className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
            >
              Start Clipping (Download in Background)
            </button>
          )}

          {status === 'error' && (
            <button
              onClick={() => navigate('/')}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Go Back
            </button>
          )}
        </div>
      </motion.div>
    </div>
    </Layout>
  )
}
