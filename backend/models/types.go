package models

type JobStatus string

const (
	JobPending    JobStatus = "pending"
	JobProcessing JobStatus = "processing"
	JobDone       JobStatus = "done"
	JobError      JobStatus = "error"
)

type Job struct {
	ID       string
	Status   JobStatus
	Progress int        // 0–100
	Message  string     // current status message for display
	Output   string     // file path of result when done
	Updates  chan JobUpdate  // internal SSE channel (buffered: 50)
	Error    string
}

type JobUpdate struct {
	Status        JobStatus `json:"status"`
	Progress      int       `json:"progress"`
	Message       string    `json:"message"`
	Output        string    `json:"output,omitempty"`
	Error         string    `json:"error,omitempty"`
	Downloaded    string    `json:"downloaded,omitempty"`    // e.g., "50.2 MB"
	Total         string    `json:"total,omitempty"`         // e.g., "123.4 MB"
	Speed         string    `json:"speed,omitempty"`         // e.g., "2.3 MB/s"
	ETA           string    `json:"eta,omitempty"`           // e.g., "00:25" or "2m 30s"
}

type Video struct {
	ID        string  `json:"id"`         // YouTube video ID
	Title     string  `json:"title"`
	Duration  float64 `json:"duration"`   // seconds
	FilePath  string  `json:"filePath"`   // local disk path to downloaded mp4
	Thumbnail string  `json:"thumbnail"`
}

type Clip struct {
	ID      string  `json:"id"`
	VideoID string  `json:"videoId"`
	Start   float64 `json:"start"`   // seconds
	End     float64 `json:"end"`     // seconds
	Label   string  `json:"label"`
}

type ExportRequest struct {
	Clips []Clip `json:"clips"`
}
