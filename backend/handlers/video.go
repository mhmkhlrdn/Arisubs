package handlers

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"aytce/backend/jobs"
	"aytce/backend/models"
	"aytce/backend/services"
	"aytce/backend/storage"
	"github.com/gin-gonic/gin"
)

type VideoHandler struct {
	queue        *jobs.JobQueue
	downloadQueue *jobs.DownloadQueue
	store        *storage.Store
	ytdlp        *services.YtDlpService
}

func NewVideoHandler(queue *jobs.JobQueue, store *storage.Store, ytdlp *services.YtDlpService) *VideoHandler {
	return &VideoHandler{
		queue:         queue,
		downloadQueue: jobs.NewDownloadQueue(),
		store:         store,
		ytdlp:         ytdlp,
	}
}

type VideoRequest struct {
	URL     string `json:"url" binding:"required"`
	Quality string `json:"quality,omitempty"` // "best", "1080p", "720p", "480p", "360p", "worst"
}

type VideoResponse struct {
	JobID   string          `json:"jobId"`
	VideoID string          `json:"videoId"`
	Video   *models.Video   `json:"video,omitempty"` // Metadata available immediately
}

func (h *VideoHandler) SubmitVideo(c *gin.Context) {
	var req VideoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Extract video ID from URL
	videoID := extractVideoID(req.URL)
	if videoID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid YouTube URL"})
		return
	}

	// Check if video already exists
	if h.store.VideoExists(videoID) {
		// Video already downloaded, return immediately with metadata
		video, err := h.store.LoadVideoMeta(videoID)
		if err != nil {
			// If metadata doesn't exist, create minimal response
			video = &models.Video{
				ID:       videoID,
				FilePath: h.store.VideoPath(videoID),
			}
		}
		c.JSON(http.StatusOK, VideoResponse{
			JobID:   "",
			VideoID: videoID,
			Video:   video,
		})
		return
	}

	// Fetch metadata immediately (before download starts) so user can start clipping
	var videoMeta *models.Video
	videoMeta, err := h.ytdlp.GetVideoMetadata(req.URL)
	if err != nil {
		// If metadata fetch fails, continue anyway - download will populate it
		videoMeta = &models.Video{
			ID: videoID,
		}
	} else {
		// Save metadata immediately so it's available
		videoMeta.ID = videoID
		if err := h.store.SaveVideoMeta(videoID, videoMeta); err != nil {
			// Non-fatal, continue
		}
	}

	// Create job
	job := h.queue.New()

	// Prepare download task
	quality := req.Quality
	if quality == "" {
		quality = "best" // Default to best quality
	}

	downloadTask := func() error {
		video, err := h.ytdlp.DownloadVideo(req.URL, h.store.VideosDir(), job, quality)
		if err != nil {
			job.Status = models.JobError
			job.Error = err.Error()
			select {
			case job.Updates <- models.JobUpdate{
				Status: models.JobError,
				Error:  err.Error(),
			}:
			default:
				// Channel full, skip
			}
			// Close channel on error
			close(job.Updates)
			return err
		}

		// Update metadata with file path
		video.ID = videoID
		if err := h.store.SaveVideoMeta(videoID, video); err != nil {
			// Non-fatal, continue
		}

		job.Output = videoID // Store videoID in output for frontend to extract
		job.Status = models.JobDone
		select {
		case job.Updates <- models.JobUpdate{
			Status:   models.JobDone,
			Progress: 100,
			Message:  "Complete",
			Output:   job.Output,
		}:
		default:
			// Channel full, skip
		}
		// Close channel when done
		close(job.Updates)
		return nil
	}

	// Enqueue download (will start immediately if queue is empty)
	wasQueued := h.downloadQueue.Enqueue(jobs.DownloadQueueItem{
		Job:     job,
		VideoID: videoID,
		URL:     req.URL,
		Quality: quality,
		Task:    downloadTask,
	})

	// If not queued, the download started immediately
	if !wasQueued {
		// Job status will be updated by the download task
	}

	c.JSON(http.StatusOK, VideoResponse{
		JobID:   job.ID,
		VideoID: videoID,
		Video:   videoMeta, // Return metadata immediately
	})
}

func extractVideoID(url string) string {
	// Match various YouTube URL formats:
	// - youtube.com/watch?v=VIDEO_ID
	// - youtu.be/VIDEO_ID
	// - youtube.com/live/VIDEO_ID
	// - youtube.com/embed/VIDEO_ID
	// - youtube.com/v/VIDEO_ID
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`(?:youtube\.com/watch\?v=|youtu\.be/)([a-zA-Z0-9_-]{11})`),
		regexp.MustCompile(`youtube\.com/live/([a-zA-Z0-9_-]{11})`),
		regexp.MustCompile(`youtube\.com/embed/([a-zA-Z0-9_-]{11})`),
		regexp.MustCompile(`youtube\.com/v/([a-zA-Z0-9_-]{11})`),
	}
	
	for _, re := range patterns {
		if matches := re.FindStringSubmatch(url); len(matches) > 1 {
			return matches[1]
		}
	}
	return ""
}

func (h *VideoHandler) GetVideo(c *gin.Context) {
	videoID := c.Param("id")
	if !h.store.VideoExists(videoID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Video not found"})
		return
	}

	video, err := h.store.LoadVideoMeta(videoID)
	if err != nil {
		// If metadata doesn't exist, create a minimal response
		video = &models.Video{
			ID:       videoID,
			FilePath: h.store.VideoPath(videoID),
		}
	}

	c.JSON(http.StatusOK, video)
}

func (h *VideoHandler) ServeVideoFile(c *gin.Context) {
	videoID := c.Param("id")
	log.Printf("[DEBUG] ServeVideoFile: Request received for video ID: %s", videoID)
	log.Printf("[DEBUG] ServeVideoFile: Request method: %s", c.Request.Method)
	
	videoPath := h.store.VideoPath(videoID)
	log.Printf("[DEBUG] ServeVideoFile: Video path: %s", videoPath)
	
	// Check if file exists using os.Stat directly
	if _, err := os.Stat(videoPath); os.IsNotExist(err) {
		log.Printf("[DEBUG] ServeVideoFile: Video file does not exist at path: %s", videoPath)
		// Try to list files in the videos directory for debugging
		videosDir := h.store.VideosDir()
		files, _ := os.ReadDir(videosDir)
		log.Printf("[DEBUG] ServeVideoFile: Files in videos directory (%s):", videosDir)
		for _, file := range files {
			log.Printf("[DEBUG] ServeVideoFile:   - %s", file.Name())
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "Video file not found", "videoId": videoID, "path": videoPath})
		return
	}

	log.Printf("[DEBUG] ServeVideoFile: Video file found, serving: %s", videoPath)
	
	// Handle HEAD requests explicitly
	if c.Request.Method == "HEAD" {
		fileInfo, err := os.Stat(videoPath)
		if err != nil {
			log.Printf("[DEBUG] ServeVideoFile: Error getting file info: %v", err)
			c.JSON(http.StatusNotFound, gin.H{"error": "Video file not found"})
			return
		}
		c.Header("Content-Type", "video/mp4")
		c.Header("Accept-Ranges", "bytes")
		c.Header("Content-Length", fmt.Sprintf("%d", fileInfo.Size()))
		c.Status(http.StatusOK)
		return
	}
	
	// Set headers for video streaming
	c.Header("Content-Type", "video/mp4")
	c.Header("Accept-Ranges", "bytes")
	c.File(videoPath)
}

func (h *VideoHandler) GetAvailableQualities(c *gin.Context) {
	url := c.Query("url")
	if url == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "URL parameter is required"})
		return
	}

	log.Printf("[DEBUG] GetAvailableQualities: Requested for URL: %s", url)
	qualities, err := h.ytdlp.GetAvailableFormats(url)
	if err != nil {
		log.Printf("[DEBUG] GetAvailableQualities: Error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	log.Printf("[DEBUG] GetAvailableQualities: Returning %d qualities: %v", len(qualities), qualities)
	c.JSON(http.StatusOK, gin.H{"qualities": qualities})
}
