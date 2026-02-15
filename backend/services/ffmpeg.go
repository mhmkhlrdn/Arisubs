package services

import (
	"arisubs/backend/models"
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type FFmpegService struct{}

func NewFFmpegService() *FFmpegService {
	return &FFmpegService{}
}

func (s *FFmpegService) ClipVideo(inputPath string, start float64, end float64, outputPath string) error {
	cmd := exec.Command("ffmpeg",
		"-ss", fmt.Sprintf("%.3f", start),
		"-to", fmt.Sprintf("%.3f", end),
		"-i", inputPath,
		"-c", "copy",
		"-avoid_negative_ts", "make_zero",
		"-y",
		outputPath,
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("ffmpeg clip failed: %w\noutput: %s", err, string(output))
	}

	return nil
}

/*
 * [ConcatVideos]
 * - Just copy the single file if only one input
 * - Create concat list file
 * - Run ffmpeg concat
 * - Parse progress from stderr
 */
func (s *FFmpegService) ConcatVideos(inputPaths []string, outputPath string, job *models.Job) error {
	if len(inputPaths) == 0 {
		return fmt.Errorf("no input files provided")
	}

	if len(inputPaths) == 1 {
		cmd := exec.Command("cp", inputPaths[0], outputPath)
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to copy single file: %w", err)
		}
		job.Updates <- models.JobUpdate{
			Status:   models.JobDone,
			Progress: 100,
			Message:  "Export complete",
			Output:   outputPath,
		}
		return nil
	}

	listFile := filepath.Join(filepath.Dir(outputPath), "concat_list.txt")
	defer os.Remove(listFile)

	file, err := os.Create(listFile)
	if err != nil {
		return fmt.Errorf("failed to create concat list: %w", err)
	}
	defer file.Close()

	for _, path := range inputPaths {
		absPath, err := filepath.Abs(path)
		if err != nil {
			return fmt.Errorf("failed to get absolute path: %w", err)
		}
		fmt.Fprintf(file, "file '%s'\n", strings.ReplaceAll(absPath, "'", "'\\''"))
	}
	file.Close()

	cmd := exec.Command("ffmpeg",
		"-f", "concat",
		"-safe", "0",
		"-i", listFile,
		"-c", "copy",
		"-y",
		outputPath,
	)

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	timeRegex := regexp.MustCompile(`time=(\d+):(\d+):(\d+\.\d+)`)
	scanner := bufio.NewScanner(stderr)
	go func() {
		for scanner.Scan() {
			line := scanner.Text()
			if matches := timeRegex.FindStringSubmatch(line); len(matches) > 3 {
				hours, _ := strconv.Atoi(matches[1])
				minutes, _ := strconv.Atoi(matches[2])
				seconds, _ := strconv.ParseFloat(matches[3], 64)
				totalSeconds := float64(hours*3600+minutes*60) + seconds
				progress := int((totalSeconds / 100.0) * 100) // rough estimate
				if progress > 100 {
					progress = 100
				}
				job.Updates <- models.JobUpdate{
					Status:   models.JobProcessing,
					Progress: progress,
					Message:  fmt.Sprintf("Merging clips... (%.1fs)", totalSeconds),
				}
			}
		}
	}()

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("ffmpeg concat failed: %w", err)
	}

	job.Updates <- models.JobUpdate{
		Status:   models.JobDone,
		Progress: 100,
		Message:  "Export complete",
		Output:   outputPath,
	}

	return nil
}

func (s *FFmpegService) ProbeVideoDuration(filePath string) (float64, error) {
	cmd := exec.Command("ffprobe",
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		filePath,
	)

	output, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe failed: %w", err)
	}

	duration, err := strconv.ParseFloat(strings.TrimSpace(string(output)), 64)
	if err != nil {
		return 0, fmt.Errorf("failed to parse duration: %w", err)
	}

	return duration, nil
}
