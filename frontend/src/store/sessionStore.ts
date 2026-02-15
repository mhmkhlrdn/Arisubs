import { create } from 'zustand'
import type { Video, Clip, TimelineBlock } from '../types'

interface SessionStore {
  // Video state
  videos: Record<string, Video>
  activeVideoId: string | null
  videoJobIds: Record<string, string> // Map videoId to jobId for tracking downloads
  setActiveVideo: (video: Video) => void
  setVideoJobId: (videoId: string, jobId: string) => void

  // Clip state
  clips: Clip[]
  addClip: (clip: Clip) => void
  updateClip: (id: string, changes: Partial<Clip>) => void
  removeClip: (id: string) => void

  // Timeline state (Screen 5)
  timelineBlocks: TimelineBlock[]
  addTimelineBlock: (block: TimelineBlock) => void
  moveTimelineBlock: (id: string, offsetSeconds: number, trackIndex: number) => void
  removeTimelineBlock: (id: string) => void

  // Export
  exportJobId: string | null
  setExportJobId: (id: string | null) => void

  // Reset
  reset: () => void
}

export const useSessionStore = create<SessionStore>((set) => ({
  videos: {},
  activeVideoId: null,
  videoJobIds: {},
  setActiveVideo: (video) => set((state) => ({
    videos: { ...state.videos, [video.id]: video },
    activeVideoId: video.id,
  })),
  setVideoJobId: (videoId, jobId) => set((state) => ({
    videoJobIds: { ...state.videoJobIds, [videoId]: jobId },
  })),

  clips: [],
  addClip: (clip) => set((state) => ({
    clips: [...state.clips, clip],
  })),
  updateClip: (id, changes) => set((state) => ({
    clips: state.clips.map((c) => (c.id === id ? { ...c, ...changes } : c)),
  })),
  removeClip: (id) => set((state) => ({
    clips: state.clips.filter((c) => c.id !== id),
  })),

  timelineBlocks: [],
  addTimelineBlock: (block) => set((state) => ({
    timelineBlocks: [...state.timelineBlocks, block],
  })),
  moveTimelineBlock: (id, offsetSeconds, trackIndex) => set((state) => ({
    timelineBlocks: state.timelineBlocks.map((b) =>
      b.id === id ? { ...b, offsetSeconds, trackIndex } : b
    ),
  })),
  removeTimelineBlock: (id) => set((state) => ({
    timelineBlocks: state.timelineBlocks.filter((b) => b.id !== id),
  })),

  exportJobId: null,
  setExportJobId: (id) => set({ exportJobId: id }),

  reset: () => set({
    videos: {},
    activeVideoId: null,
    videoJobIds: {},
    clips: [],
    timelineBlocks: [],
    exportJobId: null,
  }),
}))
