export type JobStatus = 'idle' | 'pending' | 'processing' | 'done' | 'error'

export interface JobUpdate {
  status: JobStatus
  progress: number
  message: string
  output?: string
  error?: string
  downloaded?: string  // e.g., "50.2 MB"
  total?: string      // e.g., "123.4 MB"
  speed?: string      // e.g., "2.3 MB/s"
  eta?: string        // e.g., "00:25" or "2m 30s"
}

export interface Video {
  id: string
  title: string
  duration: number     // seconds
  thumbnail: string
  filePath?: string
  isLive?: boolean
}

export interface Clip {
  id: string
  videoId: string
  start: number
  end: number
  label: string
  localPath?: string   // set after /api/clip job completes
}

export interface TimelineBlock {
  id: string
  clipId: string
  trackIndex: number
  offsetSeconds: number  // position on the timeline
  duration: number
}

export interface QualityInfo {
  label: string
  size: string
  sizeInBytes: number
}

export interface Moment {
  id: string
  start: number
  end: number
  label: string
  score: number
  intensity: 'low' | 'medium' | 'high' | 'extreme'
}
