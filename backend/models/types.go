package models

type JobStatus string

const (
	JobPending    JobStatus = "pending"
	JobProcessing JobStatus = "processing"
	JobDone       JobStatus = "done"
	JobError      JobStatus = "error"
)

/*
 * [Job]
 * - Progress: 0–100
 * - Message: current status message for display
 * - Output: file path of result when done
 * - Updates: internal SSE channel (buffered: 50)
 */
type Job struct {
	ID       string
	Status   JobStatus
	Progress int
	Message  string
	Output   string
	Updates  chan JobUpdate
	Error    string
}

/*
 * [JobUpdate]
 * - Downloaded: e.g., "50.2 MB"
 * - Total: e.g., "123.4 MB"
 * - Speed: e.g., "2.3 MB/s"
 * - ETA: e.g., "00:25" or "2m 30s"
 */
type JobUpdate struct {
	Status     JobStatus `json:"status"`
	Progress   int       `json:"progress"`
	Message    string    `json:"message"`
	Output     string    `json:"output,omitempty"`
	Error      string    `json:"error,omitempty"`
	Downloaded string    `json:"downloaded,omitempty"`
	Total      string    `json:"total,omitempty"`
	Speed      string    `json:"speed,omitempty"`
	ETA        string    `json:"eta,omitempty"`
}

/*
 * [Video]
 * - ID: YouTube video ID
 * - Duration: seconds
 * - FilePath: local disk path to downloaded mp4
 */
type Video struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Duration  float64 `json:"duration"`
	FilePath  string  `json:"filePath"`
	Thumbnail string  `json:"thumbnail"`
	IsLive    bool    `json:"isLive,omitempty"`
}

/*
 * [Clip]
 * - Start: seconds
 * - End: seconds
 */
type Clip struct {
	ID      string  `json:"id"`
	VideoID string  `json:"videoId"`
	Start   float64 `json:"start"`
	End     float64 `json:"end"`
	Label   string  `json:"label"`
}

type ExportRequest struct {
	Clips []Clip `json:"clips"`
}

type SubtitleExportRequest struct {
	VideoID    string  `json:"videoId"`
	Start      float64 `json:"start"`
	End        float64 `json:"end"`
	AssContent string  `json:"assContent"`
	Label      string  `json:"label"`
}

type QualityInfo struct {
	Label       string `json:"label"`
	Size        string `json:"size"`
	SizeInBytes int64  `json:"sizeInBytes"`
}

/*
 * [Moment]
 * Represents an exciting/highlight moment derived from chat activity
 */
type Moment struct {
	ID        string  `json:"id"`
	Start     float64 `json:"start"`
	End       float64 `json:"end"`
	Label     string  `json:"label"`
	Score     float64 `json:"score"`
	Intensity string  `json:"intensity"` // "low", "medium", "high", "extreme"
}
