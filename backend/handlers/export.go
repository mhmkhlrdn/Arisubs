package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"aytce/backend/jobs"
	"aytce/backend/models"
	"aytce/backend/services"
	"aytce/backend/storage"
	"github.com/gin-gonic/gin"
)

type ExportHandler struct {
	queue  *jobs.JobQueue
	store  *storage.Store
	ffmpeg *services.FFmpegService
}

func NewExportHandler(queue *jobs.JobQueue, store *storage.Store, ffmpeg *services.FFmpegService) *ExportHandler {
	return &ExportHandler{
		queue:  queue,
		store:  store,
		ffmpeg: ffmpeg,
	}
}

type ExportResponse struct {
	JobID string `json:"jobId"`
}

func (h *ExportHandler) ExportClips(c *gin.Context) {
	var req models.ExportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if len(req.Clips) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No clips provided"})
		return
	}

	// Create job
	job := h.queue.New()
	exportPath := h.store.ExportPath(job.ID)

	// Submit export task
	h.queue.Submit(job, func() error {
		// For each clip, ensure it's been clipped (or clip it now)
		clipPaths := make([]string, 0, len(req.Clips))

		for i, clip := range req.Clips {
			// Check if clip file already exists (from /api/clip)
			// For now, we'll need to track clip IDs to file paths
			// Simplified: assume clips need to be created
			clipPath := h.store.ClipPath(clip.ID)

			// If clip doesn't exist, create it
			if !h.store.ClipExists(clip.ID) {
				videoPath := h.store.VideoPath(clip.VideoID)
				if err := h.ffmpeg.ClipVideo(videoPath, clip.Start, clip.End, clipPath); err != nil {
					return err
				}
			}

			clipPaths = append(clipPaths, clipPath)

			// Update progress
			progress := int((float64(i+1) / float64(len(req.Clips))) * 50) // First 50% for clipping
			job.Updates <- models.JobUpdate{
				Status:   models.JobProcessing,
				Progress: progress,
				Message:  fmt.Sprintf("Processing clip %d/%d...", i+1, len(req.Clips)),
			}
		}

		// Concat all clips
		if len(clipPaths) > 1 {
			if err := h.ffmpeg.ConcatVideos(clipPaths, exportPath, job); err != nil {
				return err
			}
		} else {
			// Single clip, just copy it
			if err := h.ffmpeg.ConcatVideos(clipPaths, exportPath, job); err != nil {
				return err
			}
		}

		job.Output = exportPath
		return nil
	})

	c.JSON(http.StatusOK, ExportResponse{
		JobID: job.ID,
	})
}

func (h *ExportHandler) DownloadExport(c *gin.Context) {
	jobID := c.Param("jobId")
	job := h.queue.Get(jobID)

	if job == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Job not found"})
		return
	}

	if job.Status != models.JobDone {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Export not ready"})
		return
	}

	exportPath := h.store.ExportPath(jobID)
	filename := filepath.Base(exportPath)

	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Header("Content-Type", "video/mp4")
	c.File(exportPath)
}

func (h *ExportHandler) ExportClipsIndividually(c *gin.Context) {
	var req models.ExportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if len(req.Clips) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No clips provided"})
		return
	}

	// Create job for tracking individual clip exports
	job := h.queue.New()

	// Submit task to process all clips individually
	h.queue.Submit(job, func() error {
		for i, clip := range req.Clips {
			clipPath := h.store.ClipPath(clip.ID)

			// If clip doesn't exist, create it
			if !h.store.ClipExists(clip.ID) {
				videoPath := h.store.VideoPath(clip.VideoID)
				if err := h.ffmpeg.ClipVideo(videoPath, clip.Start, clip.End, clipPath); err != nil {
					return err
				}
			}

			// Update progress
			progress := int((float64(i+1) / float64(len(req.Clips))) * 100)
			job.Updates <- models.JobUpdate{
				Status:   models.JobProcessing,
				Progress: progress,
				Message:  fmt.Sprintf("Processing clip %d/%d: %s", i+1, len(req.Clips), clip.Label),
			}
		}

		// Mark as done - clips are ready for individual download
		job.Output = fmt.Sprintf(`{"clips":%d}`, len(req.Clips))
		return nil
	})

	c.JSON(http.StatusOK, ExportResponse{
		JobID: job.ID,
	})
}

func (h *ExportHandler) DownloadClip(c *gin.Context) {
	clipID := c.Param("clipId")
	clipPath := h.store.ClipPath(clipID)

	// Check if clip file exists
	if _, err := os.Stat(clipPath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Clip not found"})
		return
	}

	// Use clip ID as filename, or extract from path
	safeFilename := clipID + ".mp4"

	c.Header("Content-Disposition", `attachment; filename="`+safeFilename+`"`)
	c.Header("Content-Type", "video/mp4")
	c.File(clipPath)
}