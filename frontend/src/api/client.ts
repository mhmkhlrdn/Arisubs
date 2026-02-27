import type { Clip, JobUpdate, Video, QualityInfo, Moment } from '../types'

const API_BASE = '/api'

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || `HTTP ${response.status}`)
  }

  return response.json()
}

export async function submitVideoUrl(url: string, quality?: string, metadataOnly?: boolean): Promise<{ jobId: string, videoId: string, video?: Video }> {
  return fetchJSON<{ jobId: string, videoId: string, video?: Video }>(`${API_BASE}/video`, {
    method: 'POST',
    body: JSON.stringify({ url, quality, metadataOnly: metadataOnly ?? false }),
  })
}

export async function uploadVideo(file: File): Promise<{ videoId: string, video: Video }> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${API_BASE}/video/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || `HTTP ${response.status}`)
  }

  return response.json()
}

export async function listVideos(): Promise<Video[]> {
  return fetchJSON<Video[]>(`${API_BASE}/videos`)
}

export async function getVideo(videoId: string): Promise<Video> {
  return fetchJSON<Video>(`${API_BASE}/video/${videoId}`)
}

export async function createClip(clip: Omit<Clip, 'id'>): Promise<{ clipId: string, jobId: string }> {
  return fetchJSON<{ clipId: string, jobId: string }>(`${API_BASE}/clip`, {
    method: 'POST',
    body: JSON.stringify(clip),
  })
}

export async function submitExport(clips: Clip[]): Promise<{ jobId: string }> {
  return fetchJSON<{ jobId: string }>(`${API_BASE}/export`, {
    method: 'POST',
    body: JSON.stringify({ clips }),
  })
}

export async function submitExportIndividual(clips: Clip[]): Promise<{ jobId: string }> {
  return fetchJSON<{ jobId: string }>(`${API_BASE}/export/individual`, {
    method: 'POST',
    body: JSON.stringify({ clips }),
  })
}

export async function submitExportWithSubtitles(videoId: string, start: number, end: number, assContent: string, label: string, fontFiles?: File[]): Promise<{ jobId: string }> {
  // Use multipart form data when fonts are provided so FFmpeg can use them
  if (fontFiles && fontFiles.length > 0) {
    const formData = new FormData()
    formData.append('videoId', videoId)
    formData.append('start', String(start))
    formData.append('end', String(end))
    formData.append('assContent', assContent)
    formData.append('label', label)
    for (const f of fontFiles) {
      formData.append('fonts', f)
    }
    const response = await fetch(`${API_BASE}/export/subtitles`, {
      method: 'POST',
      body: formData,
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  }
  return fetchJSON<{ jobId: string }>(`${API_BASE}/export/subtitles`, {
    method: 'POST',
    body: JSON.stringify({ videoId, start, end, assContent, label }),
  })
}


export function getClipDownloadUrl(clipId: string): string {
  return `${API_BASE}/clip/${clipId}/download`
}

export async function getJobState(jobId: string): Promise<JobUpdate> {
  return fetchJSON<JobUpdate>(`${API_BASE}/jobs/${jobId}`)
}

export async function analyzeStream(url: string, duration?: number): Promise<Moment[]> {
  const result = await fetchJSON<{ moments: Moment[] }>(`${API_BASE}/video/analyze`, {
    method: 'POST',
    body: JSON.stringify({ url, duration }),
  })
  return result.moments
}

export function getDownloadUrl(jobId: string): string {
  return `${API_BASE}/export/${jobId}/download`
}

export function getVideoFileUrl(videoId: string): string {
  return `${API_BASE}/video/${videoId}/file`
}

export async function openVideoFolder(videoId: string): Promise<void> {
  await fetchJSON(`${API_BASE}/video/${videoId}/open-folder`, { method: 'POST' })
}

export async function downloadPartial(videoId: string, url: string, quality: string, start: number, end: number, isLive?: boolean): Promise<{ jobId: string, videoId: string }> {
  return fetchJSON<{ jobId: string, videoId: string }>(`${API_BASE}/video/${videoId}/download`, {
    method: 'POST',
    body: JSON.stringify({ url, quality, start, end, isLive: isLive || false }),
  })
}

export async function getAvailableQualities(url: string): Promise<QualityInfo[]> {
  const response = await fetch(`${API_BASE}/video/qualities?url=${encodeURIComponent(url)}`)
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch available qualities')
  }
  const data = await response.json()
  return data.qualities || []
}

export async function setBrowserCookies(browser: string): Promise<void> {
  const response = await fetch(`${API_BASE}/video/cookies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ browser })
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to set browser cookies');
  }
}

export async function uploadCookiesFile(file: File): Promise<void> {
  const formData = new FormData()
  formData.append('cookies', file)
  const response = await fetch(`${API_BASE}/video/cookies/upload`, {
    method: 'POST',
    body: formData
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to upload cookies file');
  }
}

export async function autoExtractCookies(): Promise<{ message: string, browser: string, count: string }> {
  const response = await fetch(`${API_BASE}/video/cookies/auto`, { method: 'POST' });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to auto-extract cookies');
  }
  return response.json();
}

export async function translateText(text: string, sourceLanguage: string, targetLanguage: string): Promise<string> {
  return fetchJSON<{ translatedText: string }>(`${API_BASE}/translate`, {
    method: 'POST',
    body: JSON.stringify({
      text,
      sourceLanguage,
      targetLanguage,
    }),
  }).then(data => data.translatedText)
}
