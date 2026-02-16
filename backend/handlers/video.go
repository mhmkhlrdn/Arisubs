package handlers

import (
	"arisubs/backend/jobs"
	"arisubs/backend/models"
	"arisubs/backend/services"
	"arisubs/backend/storage"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"

	"github.com/gin-gonic/gin"
)

type VideoHandler struct {
	queue         *jobs.JobQueue
	downloadQueue *jobs.DownloadQueue
	store         *storage.Store
	ytdlp         *services.YtDlpService
	ffmpeg        *services.FFmpegService
}

func NewVideoHandler(queue *jobs.JobQueue, store *storage.Store, ytdlp *services.YtDlpService, ffmpeg *services.FFmpegService) *VideoHandler {
	return &VideoHandler{
		queue:         queue,
		downloadQueue: jobs.NewDownloadQueue(),
		store:         store,
		ytdlp:         ytdlp,
		ffmpeg:        ffmpeg,
	}
}

type VideoRequest struct {
	URL     string `json:"url" binding:"required"`
	Quality string `json:"quality,omitempty"` // "best", "1080p", "720p", "480p", "360p", "worst"
}

type VideoResponse struct {
	JobID   string        `json:"jobId"`
	VideoID string        `json:"videoId"`
	Video   *models.Video `json:"video,omitempty"`
}

/*
 * [SubmitVideo]
 * - Extract video ID from URL
 * - Check if video already exists
 * - Fetch metadata immediately (before download starts) so user can start clipping
 * - Save metadata immediately so it's available
 * - Create job
 * - Prepare download task
 *   - Update metadata with file path
 *   - Store videoID in output for frontend to extract
 *   - Close channel when done
 * - Enqueue download (will start immediately if queue is empty)
 * - If not queued, the download started immediately
 */
func (h *VideoHandler) SubmitVideo(c *gin.Context) {
	var req VideoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	videoID := extractVideoID(req.URL)
	if videoID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid YouTube URL"})
		return
	}

	if h.store.VideoExists(videoID) {
		video, err := h.store.LoadVideoMeta(videoID)
		if err != nil {
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

	var videoMeta *models.Video
	videoMeta, err := h.ytdlp.GetVideoMetadata(req.URL)
	if err != nil {
		videoMeta = &models.Video{
			ID: videoID,
		}
	} else {
		videoMeta.ID = videoID
		if err := h.store.SaveVideoMeta(videoID, videoMeta); err != nil {
		}
	}

	job := h.queue.New()

	quality := req.Quality
	if quality == "" {
		quality = "best"
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
			}
			close(job.Updates)
			return err
		}

		video.ID = videoID
		if err := h.store.SaveVideoMeta(videoID, video); err != nil {
		}

		job.Output = videoID
		job.Status = models.JobDone
		select {
		case job.Updates <- models.JobUpdate{
			Status:   models.JobDone,
			Progress: 100,
			Message:  "Complete",
			Output:   job.Output,
		}:
		default:
		}
		close(job.Updates)
		return nil
	}

	wasQueued := h.downloadQueue.Enqueue(jobs.DownloadQueueItem{
		Job:     job,
		VideoID: videoID,
		URL:     req.URL,
		Quality: quality,
		Task:    downloadTask,
	})

	if !wasQueued {
	}

	c.JSON(http.StatusOK, VideoResponse{
		JobID:   job.ID,
		VideoID: videoID,
		Video:   videoMeta,
	})
}

/*
 * [extractVideoID]
 * - Match various YouTube URL formats:
 *   - youtube.com/watch?v=VIDEO_ID
 *   - youtu.be/VIDEO_ID
 *   - youtube.com/live/VIDEO_ID
 *   - youtube.com/embed/VIDEO_ID
 *   - youtube.com/v/VIDEO_ID
 */
func extractVideoID(url string) string {
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
		video = &models.Video{
			ID:       videoID,
			FilePath: h.store.VideoPath(videoID),
		}
	}

	c.JSON(http.StatusOK, video)
}

/*
 * [ServeVideoFile]
 * - Check if file exists using os.Stat directly
 *   - Try to list files in the videos directory for debugging
 * - Handle HEAD requests explicitly
 * - Set headers for video streaming
 */
func (h *VideoHandler) ServeVideoFile(c *gin.Context) {
	videoID := c.Param("id")
	log.Printf("[DEBUG] ServeVideoFile: Request received for video ID: %s", videoID)
	log.Printf("[DEBUG] ServeVideoFile: Request method: %s", c.Request.Method)

	videoPath := h.store.VideoPath(videoID)
	log.Printf("[DEBUG] ServeVideoFile: Video path: %s", videoPath)

	if _, err := os.Stat(videoPath); os.IsNotExist(err) {
		log.Printf("[DEBUG] ServeVideoFile: Video file does not exist at path: %s", videoPath)
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

func (h *VideoHandler) OpenVideoFolder(c *gin.Context) {
	videoID := c.Param("id")
	if !h.store.VideoExists(videoID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Video not found"})
		return
	}

	videoPath := h.store.VideoPath(videoID)
	absPath, err := filepath.Abs(videoPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to resolve path"})
		return
	}
	absPath = filepath.FromSlash(absPath)
	log.Printf("[DEBUG] OpenVideoFolder: Opening file location: %s", absPath)

	cmd := exec.Command("explorer.exe", "/select,"+absPath)
	cmd.Run()
	c.JSON(http.StatusOK, gin.H{"message": "Folder opened"})
}

func (h *VideoHandler) UploadVideo(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file uploaded"})
		return
	}
	defer file.Close()

	// Generate a unique ID (random 11 chars similar to YouTube)
	videoID := generateRandomID(11)

	// Save file
	videosDir := h.store.VideosDir()
	filePath := filepath.Join(videosDir, videoID+".mp4")
	out, err := os.Create(filePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create file"})
		return
	}
	defer out.Close()

	if _, err := io.Copy(out, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save file"})
		return
	}

	duration, err := h.ffmpeg.ProbeVideoDuration(filePath)
	if err != nil {
		log.Printf("Failed to probe video duration: %v", err)
		duration = 0
	}

	videoMeta := &models.Video{
		ID:       videoID,
		Title:    header.Filename,
		Duration: duration,
		FilePath: filePath,
	}

	if err := h.store.SaveVideoMeta(videoID, videoMeta); err != nil {
		log.Printf("Failed to save metadata: %v", err)
	}

	c.JSON(http.StatusOK, VideoResponse{
		JobID:   "",
		VideoID: videoID,
		Video:   videoMeta,
	})
}

func generateRandomID(length int) string {
	bytes := make([]byte, length/2+1)
	if _, err := rand.Read(bytes); err != nil {
		return "upload_" + fmt.Sprintf("%d", os.Getpid())
	}
	return hex.EncodeToString(bytes)[:length]
}

func (h *VideoHandler) ListVideos(c *gin.Context) {
	videos, err := h.store.ListVideos()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list videos"})
		return
	}
	c.JSON(http.StatusOK, videos)
}
