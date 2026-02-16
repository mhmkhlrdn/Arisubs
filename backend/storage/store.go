package storage

import (
	"arisubs/backend/config"
	"arisubs/backend/models"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
)

type Store struct {
	cfg *config.Config
}

func NewStore(cfg *config.Config) *Store {
	return &Store{cfg: cfg}
}

func (s *Store) Init() error {
	dirs := []string{
		s.cfg.VideosDir(),
		s.cfg.ClipsDir(),
		s.cfg.ExportsDir(),
		s.cfg.MetaDir(),
	}

	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", dir, err)
		}
	}

	return nil
}

func (s *Store) VideoPath(videoID string) string {
	return filepath.Join(s.cfg.VideosDir(), videoID+".mp4")
}

func (s *Store) ResolveVideoPath(videoID string) string {
	path := s.VideoPath(videoID)
	if _, err := os.Stat(path); err == nil {
		return path
	}

	// Try partial matches
	matches, _ := filepath.Glob(filepath.Join(s.cfg.VideosDir(), videoID+"_*.mp4"))
	if len(matches) > 0 {
		return matches[len(matches)-1] // Use the most recent
	}

	return path // Fallback to default
}

func (s *Store) ClipPath(clipID string) string {
	return filepath.Join(s.cfg.ClipsDir(), clipID+".mp4")
}

func (s *Store) ExportPath(jobID string) string {
	return filepath.Join(s.cfg.ExportsDir(), jobID+".mp4")
}

func (s *Store) MetaPath(videoID string) string {
	return filepath.Join(s.cfg.MetaDir(), videoID+".json")
}

func (s *Store) VideosDir() string {
	return s.cfg.VideosDir()
}

/*
 * [VideoExists]
 * - Check for video file existence
 * - Extensive logging for debugging path issues
 * - Fallback logic: List directory contents if file not found to help debug
 */
func (s *Store) VideoExists(videoID string) bool {
	path := s.VideoPath(videoID)
	log.Printf("[DEBUG] VideoExists: Checking for video ID: %s", videoID)

	_, err := os.Stat(path)
	if err == nil {
		log.Printf("[DEBUG] VideoExists: File found at path: %s", path)
		return true
	}

	// Check for partial download files
	matches, _ := filepath.Glob(filepath.Join(s.cfg.VideosDir(), videoID+"_*.mp4"))
	if len(matches) > 0 {
		log.Printf("[DEBUG] VideoExists: Partial file found: %s", matches[0])
		return true
	}

	log.Printf("[DEBUG] VideoExists: No video files found for ID: %s", videoID)
	return false
}

func (s *Store) ClipExists(clipID string) bool {
	_, err := os.Stat(s.ClipPath(clipID))
	return err == nil
}

func (s *Store) SaveVideoMeta(videoID string, video *models.Video) error {
	metaPath := s.MetaPath(videoID)
	data, err := json.Marshal(video)
	if err != nil {
		return err
	}
	return os.WriteFile(metaPath, data, 0644)
}

func (s *Store) LoadVideoMeta(videoID string) (*models.Video, error) {
	metaPath := s.MetaPath(videoID)
	data, err := os.ReadFile(metaPath)
	if err != nil {
		return nil, err
	}
	var video models.Video
	if err := json.Unmarshal(data, &video); err != nil {
		return nil, err
	}
	return &video, nil
}

func (s *Store) ListVideos() ([]*models.Video, error) {
	metaDir := s.cfg.MetaDir()
	files, err := os.ReadDir(metaDir)
	if err != nil {
		return nil, err
	}

	var videos []*models.Video
	for _, file := range files {
		if filepath.Ext(file.Name()) == ".json" {
			videoID := file.Name()[:len(file.Name())-5]
			video, err := s.LoadVideoMeta(videoID)
			if err == nil {
				videos = append(videos, video)
			}
		}
	}
	return videos, nil
}
