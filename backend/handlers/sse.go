package handlers

import (
	"arisubs/backend/jobs"
	"arisubs/backend/models"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type SSEHandler struct {
	queue *jobs.JobQueue
}

func NewSSEHandler(queue *jobs.JobQueue) *SSEHandler {
	return &SSEHandler{queue: queue}
}

/*
 * [StreamJob]
 * - Set SSE headers
 * - If job is already done, send final update and return
 * - Get request context to detect client disconnections
 * - Send keepalive ping every 15 seconds
 * - Channel to signal when done
 * - Send keepalive pings
 * - Stream job updates
 */
func (h *SSEHandler) StreamJob(c *gin.Context) {
	jobID := c.Param("jobId")
	job := h.queue.Get(jobID)

	if job == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Job not found"})
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Access-Control-Allow-Origin", "*")

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

	ctx := c.Request.Context()

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	done := make(chan bool, 1)

	go func() {
		defer func() {
			if r := recover(); r != nil {
			}
		}()
		for {
			select {
			case <-ticker.C:
				select {
				case <-ctx.Done():
					return
				default:
					if _, err := fmt.Fprintf(c.Writer, "data: {\"ping\":true}\n\n"); err != nil {
						return
					}
				}
			case <-done:
				return
			case <-ctx.Done():
				return
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			done <- true
			return
		case update, ok := <-job.Updates:
			if !ok {
				update := models.JobUpdate{
					Status:   job.Status,
					Progress: job.Progress,
					Message:  job.Message,
					Output:   job.Output,
					Error:    job.Error,
				}
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

			select {
			case <-ctx.Done():
				done <- true
				return
			default:
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
