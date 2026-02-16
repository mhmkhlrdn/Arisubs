package handlers

import (
	"arisubs/backend/jobs"
	"arisubs/backend/services"
	"arisubs/backend/storage"
	"bytes"
	"io"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type ClipHandler struct {
	queue  *jobs.JobQueue
	store  *storage.Store
	ffmpeg *services.FFmpegService
}

func NewClipHandler(queue *jobs.JobQueue, store *storage.Store, ffmpeg *services.FFmpegService) *ClipHandler {
	return &ClipHandler{
		queue:  queue,
		store:  store,
		ffmpeg: ffmpeg,
	}
}

type ClipRequest struct {
	VideoID string  `json:"videoId" binding:"required"`
	Start   float64 `json:"start" binding:"gte=0"`
	End     float64 `json:"end" binding:"gte=0"`
	Label   string  `json:"label"`
}

type ClipResponse struct {
	ClipID string `json:"clipId"`
	JobID  string `json:"jobId"`
}

/*
 * [CreateClip]
 * - Read and log the raw request body for debugging (before binding consumes it)
 * - Restore the body so ShouldBindJSON can read it
 * - Check if video file exists (video might still be downloading)
 * - Validate start/end
 * - Generate clip ID
 * - Create job
 * - Submit clip task
 */
func (h *ClipHandler) CreateClip(c *gin.Context) {
	var req ClipRequest

	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err == nil {
		log.Printf("[DEBUG] CreateClip: Raw request body: %s", string(bodyBytes))
		c.Request.Body = io.NopCloser(bytes.NewReader(bodyBytes))
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("[DEBUG] CreateClip: Binding error: %v", err)
		log.Printf("[DEBUG] CreateClip: Received videoId: %s, start: %v, end: %v, label: %s", req.VideoID, req.Start, req.End, req.Label)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body", "details": err.Error()})
		return
	}

	log.Printf("[DEBUG] CreateClip: Request parsed successfully - videoId: %s, start: %.2f, end: %.2f, label: %s", req.VideoID, req.Start, req.End, req.Label)

	if !h.store.VideoExists(req.VideoID) {
		c.JSON(http.StatusAccepted, gin.H{
			"error":   "Video file not ready yet",
			"message": "Video is still downloading. The clip will be created automatically once the download completes.",
			"videoId": req.VideoID,
		})
		return
	}

	if req.Start < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Start time must be >= 0", "start": req.Start})
		return
	}
	if req.End <= req.Start {
		c.JSON(http.StatusBadRequest, gin.H{"error": "End time must be greater than start time", "start": req.Start, "end": req.End})
		return
	}

	clipID := uuid.New().String()
	clipPath := h.store.ClipPath(clipID)
	videoPath := h.store.ResolveVideoPath(req.VideoID)

	job := h.queue.New()

	h.queue.Submit(job, func() error {
		if err := h.ffmpeg.ClipVideo(videoPath, req.Start, req.End, clipPath); err != nil {
			return err
		}
		job.Output = clipPath
		return nil
	})

	c.JSON(http.StatusOK, ClipResponse{
		ClipID: clipID,
		JobID:  job.ID,
	})
}
