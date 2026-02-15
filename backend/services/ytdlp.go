package services

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"aytce/backend/models"
)

type YtDlpService struct{}

func NewYtDlpService() *YtDlpService {
	return &YtDlpService{}
}

type ytDlpInfo struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Duration  float64 `json:"duration"`
	Thumbnail string  `json:"thumbnail"`
}

type VideoQuality struct {
	FormatID string `json:"formatId"`
	Quality  string `json:"quality"` // e.g., "1080p", "720p", etc.
	AudioID  string `json:"audioId"` // Best audio format ID to pair with video
}

// isNumericFormatID checks if a format string is a simple numeric ID (e.g., "18", "137")
func isNumericFormatID(format string) bool {
	for _, r := range format {
		if r < '0' || r > '9' {
			return false
		}
	}
	return len(format) > 0
}

func (s *YtDlpService) DownloadVideo(url string, outDir string, job *models.Job, quality string) (*models.Video, error) {
	// Update job status
	job.Status = models.JobProcessing
	job.Updates <- models.JobUpdate{
		Status:   models.JobProcessing,
		Progress: 0,
		Message:  "Starting download...",
	}

	// Build yt-dlp command with options to handle YouTube restrictions
	outputTemplate := filepath.Join(outDir, "%(id)s.%(ext)s")
	
	// Get explicit format IDs from default client (shows all formats)
	log.Printf("[DEBUG] DownloadVideo: Requested quality: '%s'", quality)
	formatString, err := s.GetFormatIDs(url, quality)
	if err != nil {
		log.Printf("[DEBUG] DownloadVideo: GetFormatIDs failed: %v, using fallback", err)
		// Fallback to format string if GetFormatIDs fails
		formatString = s.getFormatString(quality)
	}
	log.Printf("[DEBUG] DownloadVideo: Using format IDs/string: '%s'", formatString)
	log.Printf("[DEBUG] DownloadVideo: Output template: %s", outputTemplate)
	
	// Determine if we're using explicit format IDs (contains "+" or is just a number)
	// If using explicit format IDs, don't use android client (format IDs are from default client)
	// If using format strings (like "best"), use android client for reliability
	// Format IDs like "137+140" or "18" should not use android client
	// Format strings like "bestvideo[height<=1080]+bestaudio" should use android client
	hasExplicitFormatID := strings.Contains(formatString, "+") || isNumericFormatID(formatString)
	useAndroidClient := !hasExplicitFormatID && formatString != "best" && formatString != "worst"
	
	cmdArgs := []string{
		"-m", "yt_dlp",
		"-f", formatString,
		"--merge-output-format", "mp4",
		"--write-info-json",
		"--newline",
		"--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		"--referer", "https://www.youtube.com/",
		"--retries", "3",
		"--fragment-retries", "3",
		"--file-access-retries", "3",
		"--retry-sleep", "1",
		"-o", outputTemplate,
		url,
	}
	
	// Only add android client if not using explicit format IDs
	if useAndroidClient {
		cmdArgs = append(cmdArgs, "--extractor-args", "youtube:player_client=android")
		log.Printf("[DEBUG] DownloadVideo: Using android client with format string")
	} else {
		log.Printf("[DEBUG] DownloadVideo: Using default client with explicit format IDs")
	}
	
	cmd := exec.Command("py", cmdArgs...)
	
	log.Printf("[DEBUG] DownloadVideo: Starting yt-dlp command with format: %s", formatString)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start yt-dlp: %w", err)
	}

	// Parse progress from stdout
	// yt-dlp format: [download] 45.2% of 123.45MiB at 2.34MiB/s ETA 00:25
	// or: [download] 45.2% of ~123.45MiB at 2.34MiB/s ETA 00:25
	progressRegex := regexp.MustCompile(`\[download\]\s+(\d+\.?\d*)%\s+of\s+~?([\d.]+)([KMGT]?i?B)\s+(?:at\s+([\d.]+)([KMGT]?i?B/s))?\s*(?:ETA\s+([\d:]+))?`)
	scanner := bufio.NewScanner(stdout)
	go func() {
		for scanner.Scan() {
			line := scanner.Text()
			log.Printf("[DEBUG] DownloadVideo stdout: %s", line)
			if matches := progressRegex.FindStringSubmatch(line); len(matches) > 1 {
				progress, err := strconv.ParseFloat(matches[1], 64)
				if err == nil {
					// Extract total size
					totalSize := ""
					if len(matches) > 3 && matches[2] != "" && matches[3] != "" {
						totalSize = matches[2] + matches[3]
					}
					
					// Extract speed
					speed := ""
					if len(matches) > 5 && matches[4] != "" && matches[5] != "" {
						speed = matches[4] + matches[5]
					}
					
					// Extract ETA
					eta := ""
					if len(matches) > 6 && matches[6] != "" {
						eta = matches[6]
					}
					
					// Calculate downloaded size from percentage and total
					downloaded := ""
					if totalSize != "" {
						totalBytes := parseSize(totalSize)
						if totalBytes > 0 {
							downloadedBytes := int64(float64(totalBytes) * progress / 100.0)
							downloaded = formatSize(downloadedBytes)
							// Format total size nicely
							totalSize = formatSize(totalBytes)
						}
					}
					
					log.Printf("[DEBUG] DownloadVideo: Progress update: %.1f%%, Downloaded: %s, Total: %s, Speed: %s, ETA: %s", 
						progress, downloaded, totalSize, speed, eta)
					
					job.Updates <- models.JobUpdate{
						Status:     models.JobProcessing,
						Progress:   int(progress),
						Message:    "Downloading...",
						Downloaded: downloaded,
						Total:      totalSize,
						Speed:      speed,
						ETA:        eta,
					}
				}
			}
		}
		if err := scanner.Err(); err != nil {
			log.Printf("[DEBUG] DownloadVideo: Scanner error: %v", err)
		}
	}()

	// Read stderr for errors and progress (yt-dlp outputs progress to stderr)
	stderrData := strings.Builder{}
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			log.Printf("[DEBUG] DownloadVideo stderr: %s", line)
			stderrData.WriteString(line + "\n")
			
			// Also parse progress from stderr (yt-dlp outputs progress here)
			if matches := progressRegex.FindStringSubmatch(line); len(matches) > 1 {
				progress, err := strconv.ParseFloat(matches[1], 64)
				if err == nil {
					// Extract total size
					totalSize := ""
					if len(matches) > 3 && matches[2] != "" && matches[3] != "" {
						totalSize = matches[2] + matches[3]
					}
					
					// Extract speed
					speed := ""
					if len(matches) > 5 && matches[4] != "" && matches[5] != "" {
						speed = matches[4] + matches[5]
					}
					
					// Extract ETA
					eta := ""
					if len(matches) > 6 && matches[6] != "" {
						eta = matches[6]
					}
					
					// Calculate downloaded size from percentage and total
					downloaded := ""
					if totalSize != "" {
						totalBytes := parseSize(totalSize)
						if totalBytes > 0 {
							downloadedBytes := int64(float64(totalBytes) * progress / 100.0)
							downloaded = formatSize(downloadedBytes)
							// Format total size nicely
							totalSize = formatSize(totalBytes)
						}
					}
					
					log.Printf("[DEBUG] DownloadVideo: Progress update: %.1f%%, Downloaded: %s, Total: %s, Speed: %s, ETA: %s", 
						progress, downloaded, totalSize, speed, eta)
					
					job.Updates <- models.JobUpdate{
						Status:     models.JobProcessing,
						Progress:   int(progress),
						Message:    "Downloading...",
						Downloaded: downloaded,
						Total:      totalSize,
						Speed:     speed,
						ETA:        eta,
					}
				}
			}
		}
		if err := scanner.Err(); err != nil {
			log.Printf("[DEBUG] DownloadVideo: Stderr scanner error: %v", err)
		}
	}()

	log.Printf("[DEBUG] DownloadVideo: Waiting for command to complete...")
	if err := cmd.Wait(); err != nil {
		stderrStr := stderrData.String()
		log.Printf("[DEBUG] DownloadVideo: Command failed with error: %v", err)
		log.Printf("[DEBUG] DownloadVideo: Full stderr output:\n%s", stderrStr)
		// Provide more helpful error messages
		if strings.Contains(stderrStr, "HTTP Error 403") || strings.Contains(stderrStr, "Forbidden") {
			return nil, fmt.Errorf("YouTube blocked the request (403 Forbidden). This may be due to rate limiting or regional restrictions. Try updating yt-dlp with: yt-dlp -U\n\nstderr: %s", stderrStr)
		}
		if strings.Contains(stderrStr, "HTTP Error 400") {
			return nil, fmt.Errorf("YouTube rejected the request (400 Bad Request). This may be due to an outdated yt-dlp version. Try updating with: yt-dlp -U\n\nstderr: %s", stderrStr)
		}
		if strings.Contains(stderrStr, "Requested format is not available") {
			return nil, fmt.Errorf("The requested format is not available. This may happen if the format IDs don't match. Try using 'best' quality instead.\n\nstderr: %s", stderrStr)
		}
		return nil, fmt.Errorf("yt-dlp failed: %w\nstderr: %s", err, stderrStr)
	}
	
	log.Printf("[DEBUG] DownloadVideo: Command completed successfully")

	// Read info.json to get metadata
	log.Printf("[DEBUG] DownloadVideo: Looking for info.json files in: %s", outDir)
	infoFiles, err := filepath.Glob(filepath.Join(outDir, "*.info.json"))
	if err != nil {
		log.Printf("[DEBUG] DownloadVideo: Error globbing info.json: %v", err)
		return nil, fmt.Errorf("failed to find info.json file: %w", err)
	}
	if len(infoFiles) == 0 {
		log.Printf("[DEBUG] DownloadVideo: No info.json files found in: %s", outDir)
		// List all files in the directory for debugging
		allFiles, _ := os.ReadDir(outDir)
		log.Printf("[DEBUG] DownloadVideo: Files in output directory:")
		for _, file := range allFiles {
			log.Printf("[DEBUG] DownloadVideo:   - %s", file.Name())
		}
		return nil, fmt.Errorf("failed to find info.json file in %s", outDir)
	}
	log.Printf("[DEBUG] DownloadVideo: Found info.json: %s", infoFiles[0])

	infoData, err := os.ReadFile(infoFiles[0])
	if err != nil {
		return nil, fmt.Errorf("failed to read info.json: %w", err)
	}

	var info ytDlpInfo
	if err := json.Unmarshal(infoData, &info); err != nil {
		return nil, fmt.Errorf("failed to parse info.json: %w", err)
	}

	// Find the downloaded video file
	log.Printf("[DEBUG] DownloadVideo: Looking for video file: %s.mp4", info.ID)
	videoFiles, err := filepath.Glob(filepath.Join(outDir, info.ID+".mp4"))
	if err != nil {
		log.Printf("[DEBUG] DownloadVideo: Error globbing video file: %v", err)
		return nil, fmt.Errorf("failed to find downloaded video file: %w", err)
	}
	if len(videoFiles) == 0 {
		log.Printf("[DEBUG] DownloadVideo: Video file not found. Looking for any .mp4 files...")
		// Try to find any mp4 file
		allMp4, _ := filepath.Glob(filepath.Join(outDir, "*.mp4"))
		log.Printf("[DEBUG] DownloadVideo: Found %d mp4 files:", len(allMp4))
		for _, f := range allMp4 {
			log.Printf("[DEBUG] DownloadVideo:   - %s", f)
		}
		return nil, fmt.Errorf("failed to find downloaded video file %s.mp4 in %s", info.ID, outDir)
	}
	
	// Check file size
	fileInfo, err := os.Stat(videoFiles[0])
	if err != nil {
		log.Printf("[DEBUG] DownloadVideo: Error statting video file: %v", err)
	} else {
		log.Printf("[DEBUG] DownloadVideo: Video file size: %d bytes (%.2f MB)", fileInfo.Size(), float64(fileInfo.Size())/1024/1024)
		log.Printf("[DEBUG] DownloadVideo: Video file path: %s", videoFiles[0])
	}

	videoPath := videoFiles[0]
	
	// Verify file is accessible
	if _, err := os.Open(videoPath); err != nil {
		log.Printf("[DEBUG] DownloadVideo: WARNING - File exists but cannot be opened: %v", err)
	} else {
		log.Printf("[DEBUG] DownloadVideo: File verified as accessible")
	}

	job.Updates <- models.JobUpdate{
		Status:   models.JobDone,
		Progress: 100,
		Message:  "Download complete",
		Output:   info.ID, // Use video ID instead of file path
	}

	return &models.Video{
		ID:        info.ID,
		Title:     info.Title,
		Duration:  info.Duration,
		FilePath:  videoPath,
		Thumbnail: info.Thumbnail,
	}, nil
}

func (s *YtDlpService) GetVideoMetadata(url string) (*models.Video, error) {
	cmd := exec.Command("py", "-m", "yt_dlp",
		"--dump-json",
		"--no-download",
		"--extractor-args", "youtube:player_client=android",
		"--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		"--referer", "https://www.youtube.com/",
		url,
	)

	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("yt-dlp failed: %s", string(exitErr.Stderr))
		}
		return nil, fmt.Errorf("failed to run yt-dlp: %w", err)
	}

	var info ytDlpInfo
	if err := json.Unmarshal(output, &info); err != nil {
		return nil, fmt.Errorf("failed to parse yt-dlp output: %w", err)
	}

	return &models.Video{
		ID:        info.ID,
		Title:     info.Title,
		Duration:  info.Duration,
		Thumbnail: info.Thumbnail,
	}, nil
}

// GetAvailableFormats returns available video formats/qualities for a URL using -F flag
func (s *YtDlpService) GetAvailableFormats(url string) ([]string, error) {
	log.Printf("[DEBUG] GetAvailableFormats: Fetching formats for URL: %s", url)
	
	// Don't use android client for format listing - it limits available formats
	// Use default client to get full format list
	cmd := exec.Command("py", "-m", "yt_dlp",
		"-F",
		url,
	)

	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			log.Printf("[DEBUG] GetAvailableFormats: yt-dlp error: %s", string(exitErr.Stderr))
			return nil, fmt.Errorf("yt-dlp failed: %s", string(exitErr.Stderr))
		}
		log.Printf("[DEBUG] GetAvailableFormats: Command error: %v", err)
		return nil, fmt.Errorf("failed to run yt-dlp: %w", err)
	}

	// Parse the output to extract mp4 formats with quality labels
	outputStr := string(output)
	log.Printf("[DEBUG] GetAvailableFormats: Output length: %d characters", len(outputStr))
	log.Printf("[DEBUG] GetAvailableFormats: Full yt-dlp -F output:\n%s", outputStr)
	
	lines := strings.Split(outputStr, "\n")
	log.Printf("[DEBUG] GetAvailableFormats: Parsing %d lines", len(lines))
	
	// Map to store quality -> format info
	qualityMap := make(map[string]bool)
	
	// Quality labels to look for - check higher quality variants first (e.g., "1080p60" before "1080p")
	qualityLabels := []string{"1080p60", "1080p", "720p60", "720p", "480p", "360p", "240p", "144p"}
	
	for i, line := range lines {
		// Skip header lines and empty lines
		trimmedLine := strings.TrimSpace(line)
		if trimmedLine == "" || strings.Contains(line, "ID  EXT") || strings.Contains(line, "───") {
			continue
		}
		
		// Check if line contains mp4
		if !strings.Contains(line, "mp4") {
			continue
		}
		
		// Extract format ID
		formatIDRegex := regexp.MustCompile(`^\s*(\d+)\s+mp4`)
		formatIDMatch := formatIDRegex.FindStringSubmatch(line)
		if len(formatIDMatch) < 2 {
			continue
		}
		formatID := formatIDMatch[1]
		
		// Look for quality labels anywhere in the line
		for _, quality := range qualityLabels {
			// Check if this quality label appears in the line
			// Match "1080p60", "1080p", "720p60", "720p", etc.
			// Use word boundary to avoid partial matches
			qualityPattern := regexp.MustCompile(`\b` + regexp.QuoteMeta(quality) + `\b`)
			if qualityPattern.MatchString(line) {
				// Normalize to base quality (e.g., "1080p60" -> "1080p", "720p60" -> "720p")
				normalizedQuality := quality
				if strings.HasSuffix(quality, "60") {
					normalizedQuality = strings.TrimSuffix(quality, "60")
				}
				log.Printf("[DEBUG] GetAvailableFormats: Found format ID %s with quality %s (normalized to %s) (line %d): %s", formatID, quality, normalizedQuality, i, trimmedLine)
				qualityMap[normalizedQuality] = true
				break // Found a quality for this format, move to next line
			}
		}
	}
	
	log.Printf("[DEBUG] GetAvailableFormats: Found qualities: %v", qualityMap)
	
	// Sort qualities: 1080p, 720p, 480p, 360p, 240p, 144p
	sortedQualities := []string{"best"}
	qualityOrder := []string{"1080p", "720p", "480p", "360p", "240p", "144p"}
	for _, q := range qualityOrder {
		if qualityMap[q] {
			sortedQualities = append(sortedQualities, q)
		}
	}
	
	// Add worst if we have any qualities
	if len(sortedQualities) > 1 {
		sortedQualities = append(sortedQualities, "worst")
	}
	
	log.Printf("[DEBUG] GetAvailableFormats: Returning sorted qualities: %v", sortedQualities)
	
	return sortedQualities, nil
}

// GetFormatIDs returns the format ID(s) to use for a given quality
// Uses default client to get all available format IDs (137, 136, 135, etc.)
func (s *YtDlpService) GetFormatIDs(url string, quality string) (string, error) {
	log.Printf("[DEBUG] GetFormatIDs: Getting format IDs for quality '%s' from URL: %s (using default client)", quality, url)
	
	if quality == "best" {
		log.Printf("[DEBUG] GetFormatIDs: Using 'best' - will let yt-dlp choose")
		return "best", nil
	}
	if quality == "worst" {
		log.Printf("[DEBUG] GetFormatIDs: Using 'worst' - will let yt-dlp choose")
		return "worst", nil
	}
	
	// Use default client to get all available format IDs
	cmd := exec.Command("py", "-m", "yt_dlp",
		"-F",
		url,
	)

	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			log.Printf("[DEBUG] GetFormatIDs: yt-dlp error: %s", string(exitErr.Stderr))
			return "", fmt.Errorf("yt-dlp failed: %s", string(exitErr.Stderr))
		}
		log.Printf("[DEBUG] GetFormatIDs: Command error: %v", err)
		return "", fmt.Errorf("failed to run yt-dlp: %w", err)
	}

	outputStr := string(output)
	log.Printf("[DEBUG] GetFormatIDs: Full yt-dlp -F output:\n%s", outputStr)
	lines := strings.Split(outputStr, "\n")
	log.Printf("[DEBUG] GetFormatIDs: Parsing %d lines for quality '%s'", len(lines), quality)
	
	// Find best audio format ID (prefer 140, fallback to any m4a)
	bestAudioID := ""
	audioRegex := regexp.MustCompile(`^\s*(\d+)\s+m4a\s+audio only`)
	for _, line := range lines {
		if matches := audioRegex.FindStringSubmatch(line); len(matches) > 1 {
			audioID := matches[1]
			log.Printf("[DEBUG] GetFormatIDs: Found audio format ID: %s (line: %s)", audioID, strings.TrimSpace(line))
			// Prefer 140, but accept any m4a audio
			if audioID == "140" {
				bestAudioID = "140"
				break
			} else if bestAudioID == "" {
				bestAudioID = audioID
			}
		}
	}
	if bestAudioID == "" {
		log.Printf("[DEBUG] GetFormatIDs: No audio format found, falling back to format string")
		return s.getFormatString(quality), nil
	}
	log.Printf("[DEBUG] GetFormatIDs: Selected audio format ID: %s", bestAudioID)
	
	// Find video format ID for the requested quality
	var formatID string
	var isCombined bool
	
	log.Printf("[DEBUG] GetFormatIDs: Looking for combined format (video+audio) with quality '%s'", quality)
	// Create pattern that matches both base quality and quality60 (e.g., "1080p" or "1080p60")
	qualityPattern := regexp.MustCompile(`\b` + regexp.QuoteMeta(quality) + `(?:60)?\b`)
	for i, line := range lines {
		trimmedLine := strings.TrimSpace(line)
		// Check if it's a combined format (has both video and audio, no "video only")
		if strings.Contains(line, "mp4") && !strings.Contains(line, "video only") && qualityPattern.MatchString(line) {
			if matches := regexp.MustCompile(`^\s*(\d+)\s+mp4`).FindStringSubmatch(line); len(matches) > 1 {
				formatID = matches[1]
				isCombined = true
				log.Printf("[DEBUG] GetFormatIDs: Found combined format ID %s (line %d): %s", formatID, i, trimmedLine)
				break
			}
		}
	}
	
	// If no combined format found, look for video-only format
	if !isCombined {
		log.Printf("[DEBUG] GetFormatIDs: No combined format found, looking for video-only format with quality '%s'", quality)
		for i, line := range lines {
			trimmedLine := strings.TrimSpace(line)
			if strings.Contains(line, "mp4") && strings.Contains(line, "video only") && qualityPattern.MatchString(line) {
				if matches := regexp.MustCompile(`^\s*(\d+)\s+mp4`).FindStringSubmatch(line); len(matches) > 1 {
					formatID = matches[1]
					log.Printf("[DEBUG] GetFormatIDs: Found video-only format ID %s (line %d): %s", formatID, i, trimmedLine)
					break
				}
			}
		}
	}
	
	if formatID == "" {
		log.Printf("[DEBUG] GetFormatIDs: No format ID found for quality '%s', falling back to format string", quality)
		fallback := s.getFormatString(quality)
		log.Printf("[DEBUG] GetFormatIDs: Using fallback format string: %s", fallback)
		return fallback, nil
	}
	
	// If it's a combined format, use it directly; otherwise combine with audio
	if isCombined {
		log.Printf("[DEBUG] GetFormatIDs: Using explicit combined format ID: %s", formatID)
		return formatID, nil
	}
	
	// Return explicit format IDs: videoID+audioID (e.g., "137+140")
	result := fmt.Sprintf("%s+%s", formatID, bestAudioID)
	log.Printf("[DEBUG] GetFormatIDs: Using explicit format IDs: %s (video: %s, audio: %s)", result, formatID, bestAudioID)
	return result, nil
}

// getFormatString returns the yt-dlp format string based on quality preference
func (s *YtDlpService) getFormatString(quality string) string {
	switch quality {
	case "1080p":
		// Try for 1080p, fallback to best if not available
		return "bestvideo[height>=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best"
	case "720p":
		// Try for 720p, fallback to best if not available
		return "bestvideo[height>=720][height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best"
	case "480p":
		// Try for 480p, fallback to best if not available
		return "bestvideo[height>=480][height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best"
	case "360p":
		// Try for 360p, fallback to best if not available
		return "bestvideo[height>=360][height<=360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best"
	case "worst":
		return "worst[ext=mp4]/worst"
	default:
		// "best" or empty - default to best quality
		return "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
	}
}

// parseSize converts size strings like "123.45MiB" or "2.5GB" to bytes
func parseSize(sizeStr string) int64 {
	// Remove spaces and convert to lowercase for easier parsing
	sizeStr = strings.TrimSpace(strings.ToLower(sizeStr))
	
	// Find the number part
	var numStr string
	var unit string
	for i, r := range sizeStr {
		if (r >= '0' && r <= '9') || r == '.' {
			numStr += string(r)
		} else {
			unit = sizeStr[i:]
			break
		}
	}
	
	if numStr == "" {
		return 0
	}
	
	num, err := strconv.ParseFloat(numStr, 64)
	if err != nil {
		return 0
	}
	
	// Parse unit
	unit = strings.TrimSpace(unit)
	var multiplier float64 = 1
	
	if strings.HasPrefix(unit, "k") {
		multiplier = 1024
	} else if strings.HasPrefix(unit, "m") {
		multiplier = 1024 * 1024
	} else if strings.HasPrefix(unit, "g") {
		multiplier = 1024 * 1024 * 1024
	} else if strings.HasPrefix(unit, "t") {
		multiplier = 1024 * 1024 * 1024 * 1024
	}
	
	// Handle binary vs decimal units (iB vs B)
	if strings.Contains(unit, "ib") {
		// Already using binary (1024-based)
	} else if strings.Contains(unit, "b") && !strings.Contains(unit, "ib") {
		// Decimal units (1000-based) - but yt-dlp uses binary, so keep as is
	}
	
	return int64(num * multiplier)
}

// formatSize converts bytes to human-readable format like "123.4 MB"
func formatSize(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	
	units := []string{"KB", "MB", "GB", "TB"}
	if exp < len(units) {
		return fmt.Sprintf("%.1f %s", float64(bytes)/float64(div), units[exp])
	}
	return fmt.Sprintf("%.1f PB", float64(bytes)/float64(div))
}
