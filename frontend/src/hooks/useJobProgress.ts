import { useEffect, useState } from 'react'
import type { JobStatus, JobUpdate } from '../types'

export function useJobProgress(jobId: string | null | undefined): {
  progress: number
  status: JobStatus
  message: string
  output?: string
  error?: string
  downloaded?: string
  total?: string
  speed?: string
  eta?: string
} {
  const [state, setState] = useState<JobUpdate>({
    status: 'idle',
    progress: 0,
    message: '',
  })

  useEffect(() => {
    // Handle null, undefined, or the string "undefined"
    if (!jobId || jobId === 'undefined' || jobId === 'null') {
      setState({ status: 'idle', progress: 0, message: '' })
      return
    }

    const eventSource = new EventSource(`/api/jobs/${jobId}/stream`)

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.ping) {
          return // Ignore keepalive pings
        }
        setState(data as JobUpdate)
      } catch (err) {
        console.error('Failed to parse SSE message:', err)
      }
    }

    eventSource.onerror = (err) => {
      console.error('SSE error:', err)
      eventSource.close()
    }

    return () => {
      eventSource.close()
    }
  }, [jobId])

  return {
    progress: state.progress,
    status: state.status,
    message: state.message,
    output: state.output,
    error: state.error,
    downloaded: state.downloaded,
    total: state.total,
    speed: state.speed,
    eta: state.eta,
  }
}
