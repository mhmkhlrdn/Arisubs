package handlers

import (
	"fmt"
	"net/http"
	"time"
	"aytce/backend/jobs"
	"aytce/backend/models"
	"github.com/gin-gonic/gin"
)

type SSEHandler struct {
	queue *jobs.JobQueue
}

func NewSSEHandler(queue *jobs.JobQueue) *SSEHandler {
	return &SSEHandler{queue: queue}
}

func (h *SSEHandler) StreamJob(c *gin.Context) {
	jobID := c.Param("jobId")
	job := h.queue.Get(jobID)

	if job == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Job not found"})
		return
	}

	// Set SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Access-Control-Allow-Origin", "*")

	// If job is already done, send final update and return
	if job.Status == models.JobDone || job.Status == models.JobError {
		update := models.JobUpdate{
			Status:   job.Status,
			Progress: job.Progress,
			Message:  job.Message,
			Output:   job.Output,
			Error:    job.Error,
		}
		c.SSEvent("message", update)
		c.Writer.Flush()
		return
	}

	// Get request context to detect client disconnections
	ctx := c.Request.Context()

	// Send keepalive ping every 15 seconds
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	// Channel to signal when done
	done := make(chan bool, 1)

	// Send keepalive pings
	go func() {
		defer func() {
			// Recover from any panics (e.g., writing to closed connection)
			if r := recover(); r != nil {
				// Client disconnected, ignore
			}
		}()
		for {
			select {
			case <-ticker.C:
				select {
				case <-ctx.Done():
					// Client disconnected
					return
				default:
					// Try to send ping, but don't error if connection is closed
					if _, err := fmt.Fprintf(c.Writer, "data: {\"ping\":true}\n\n"); err != nil {
						return
					}
				}
			case <-done:
				return
			case <-ctx.Done():
				// Client disconnected
				return
			}
		}
	}()

	// Stream job updates
	for {
		select {
		case <-ctx.Done():
			// Client disconnected
			done <- true
			return
		case update, ok := <-job.Updates:
			if !ok {
				// Channel closed, send final update
				update := models.JobUpdate{
					Status:   job.Status,
					Progress: job.Progress,
					Message:  job.Message,
					Output:   job.Output,
					Error:    job.Error,
				}
				// Try to send final update, but don't error if connection is closed
				select {
				case <-ctx.Done():
					return
				default:
					c.SSEvent("message", update)
					c.Writer.Flush()
				}
				done <- true
				return
			}

			// Check if client disconnected before sending
			select {
			case <-ctx.Done():
				done <- true
				return
			default:
				// Try to send update, but handle errors gracefully
				c.SSEvent("message", update)
			}

			if update.Status == models.JobDone || update.Status == models.JobError {
				done <- true
				return
			}
		}
	}
}

func (h *SSEHandler) GetJob(c *gin.Context) {
	jobID := c.Param("jobId")
	job := h.queue.Get(jobID)

	if job == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Job not found"})
		return
	}

	update := models.JobUpdate{
		Status:   job.Status,
		Progress: job.Progress,
		Message:  job.Message,
		Output:   job.Output,
		Error:    job.Error,
	}

	c.JSON(http.StatusOK, update)
}

func (h *SSEHandler) DeleteJob(c *gin.Context) {
	jobID := c.Param("jobId")
	h.queue.Delete(jobID)
	c.JSON(http.StatusOK, gin.H{"message": "Job deleted"})
}
