package handlers

import (
	"arisubs/backend/jobs"
	"arisubs/backend/models"
	"arisubs/backend/services"
	"arisubs/backend/storage"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

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

/*
 * [ExportClips]
 * - Create job
 * - Submit export task
 * - For each clip, ensure it's been clipped (or clip it now)
 * - Check if clip file already exists (from /api/clip)
 * - If clip doesn't exist, create it
 * - Update progress
 * - Concat all clips (or just copy if single)
 */
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

	job := h.queue.New()
	exportPath := h.store.ExportPath(job.ID)

	h.queue.Submit(job, func() error {
		clipPaths := make([]string, 0, len(req.Clips))

		for i, clip := range req.Clips {
			clipPath := h.store.ClipPath(clip.ID)

			if !h.store.ClipExists(clip.ID) {
				videoPath := h.store.ResolveVideoPath(clip.VideoID)
				if err := h.ffmpeg.ClipVideo(videoPath, clip.Start, clip.End, clipPath); err != nil {
					return err
				}
			}

			clipPaths = append(clipPaths, clipPath)

			progress := int((float64(i+1) / float64(len(req.Clips))) * 50) // First 50% for clipping
			job.Updates <- models.JobUpdate{
				Status:   models.JobProcessing,
				Progress: progress,
				Message:  fmt.Sprintf("Processing clip %d/%d...", i+1, len(req.Clips)),
			}
		}

		if len(clipPaths) > 1 {
			if err := h.ffmpeg.ConcatVideos(clipPaths, exportPath, job); err != nil {
				return err
			}
		} else {
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

/*
 * [ExportClipsIndividually]
 * - Create job for tracking individual clip exports
 * - Submit task to process all clips individually
 * - If clip doesn't exist, create it
 * - Update progress
 * - Mark as done - clips are ready for individual download
 */
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

	job := h.queue.New()

	h.queue.Submit(job, func() error {
		for i, clip := range req.Clips {
			clipPath := h.store.ClipPath(clip.ID)

			if !h.store.ClipExists(clip.ID) {
				videoPath := h.store.ResolveVideoPath(clip.VideoID)
				if err := h.ffmpeg.ClipVideo(videoPath, clip.Start, clip.End, clipPath); err != nil {
					return err
				}
			}

			progress := int((float64(i+1) / float64(len(req.Clips))) * 100)
			job.Updates <- models.JobUpdate{
				Status:   models.JobProcessing,
				Progress: progress,
				Message:  fmt.Sprintf("Processing clip %d/%d: %s", i+1, len(req.Clips), clip.Label),
			}
		}

		job.Output = fmt.Sprintf(`{"clips":%d}`, len(req.Clips))
		return nil
	})

	c.JSON(http.StatusOK, ExportResponse{
		JobID: job.ID,
	})
}

/*
 * [DownloadClip]
 * - Check if clip file exists
 * - Use clip ID as filename, or extract from path
 */
func (h *ExportHandler) DownloadClip(c *gin.Context) {
	clipID := c.Param("clipId")
	clipPath := h.store.ClipPath(clipID)

	if _, err := os.Stat(clipPath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Clip not found"})
		return
	}

	safeFilename := clipID + ".mp4"

	c.Header("Content-Disposition", `attachment; filename="`+safeFilename+`"`)
	c.Header("Content-Type", "video/mp4")
	c.File(clipPath)
}

/*
 * [ExportWithSubtitles]
 * - Bind SubtitleExportRequest (JSON or multipart form data)
 * - Save uploaded font files to a temp directory if provided
 * - Create job for burn process
 * - Call ffmpeg.BurnSubtitles with optional fonts directory
 */
func (h *ExportHandler) ExportWithSubtitles(c *gin.Context) {
	var req models.SubtitleExportRequest
	var fontsDir string

	contentType := c.GetHeader("Content-Type")
	if strings.HasPrefix(contentType, "multipart/form-data") {
		// Parse multipart form with font files
		req.VideoID = c.PostForm("videoId")
		req.AssContent = c.PostForm("assContent")
		req.Label = c.PostForm("label")
		if s, err := strconv.ParseFloat(c.PostForm("start"), 64); err == nil {
			req.Start = s
		}
		if e, err := strconv.ParseFloat(c.PostForm("end"), 64); err == nil {
			req.End = e
		}

		// Save uploaded font files to a temp directory
		form, err := c.MultipartForm()
		if err == nil && form.File["fonts"] != nil {
			tmpDir, err := os.MkdirTemp("", "arisubs-fonts-*")
			if err == nil {
				fontsDir = tmpDir
				for _, fh := range form.File["fonts"] {
					dst := filepath.Join(tmpDir, fh.Filename)
					if err := c.SaveUploadedFile(fh, dst); err != nil {
						log.Printf("[Export] Failed to save font file %s: %v", fh.Filename, err)
					} else {
						log.Printf("[Export] Saved font file: %s", dst)
					}
				}
			}
		}
	} else {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
			return
		}
	}

	if req.VideoID == "" || req.AssContent == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing videoId or assContent"})
		return
	}

	job := h.queue.New()
	exportPath := h.store.ExportPath(job.ID)
	videoPath := h.store.ResolveVideoPath(req.VideoID)

	capturedFontsDir := fontsDir
	h.queue.Submit(job, func() error {
		// Clean up temp fonts directory after burn completes
		if capturedFontsDir != "" {
			defer os.RemoveAll(capturedFontsDir)
		}
		return h.ffmpeg.BurnSubtitles(videoPath, req.AssContent, req.Start, req.End, exportPath, job, capturedFontsDir)
	})

	c.JSON(http.StatusOK, ExportResponse{
		JobID: job.ID,
	})
}
