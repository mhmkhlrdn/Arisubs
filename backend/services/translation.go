package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

func contains(s, substr string) bool {
	return strings.Contains(strings.ToLower(s), strings.ToLower(substr))
}

type TranslationService struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

func NewTranslationService(baseURL string, apiKey string) *TranslationService {
	if baseURL == "" {
		baseURL = "https://libretranslate.com"
	}

	return &TranslationService{
		baseURL: baseURL,
		apiKey:  apiKey,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

type TranslateRequest struct {
	Q      string `json:"q"`
	Source string `json:"source"`
	Target string `json:"target"`
	Format string `json:"format"`
	APIKey string `json:"api_key,omitempty"`
}

type TranslateResponse struct {
	TranslatedText string `json:"translatedText"`
}

func (s *TranslationService) Translate(text string, sourceLang string, targetLang string) (string, error) {
	if text == "" {
		return "", fmt.Errorf("text cannot be empty")
	}

	// Map language codes - LibreTranslate uses standard ISO codes
	// Handle "auto" for auto-detection
	if sourceLang == "auto" {
		sourceLang = "auto"
	}

	// Build request
	reqBody := TranslateRequest{
		Q:      text,
		Source: sourceLang,
		Target: targetLang,
		Format: "text",
	}

	// Add API key if provided
	if s.apiKey != "" {
		reqBody.APIKey = s.apiKey
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	// Make request to LibreTranslate
	url := fmt.Sprintf("%s/translate", s.baseURL)
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		errorMsg := string(bodyBytes)
		
		// Provide helpful error message for API key requirement
		if resp.StatusCode == http.StatusBadRequest && (s.apiKey == "" || contains(errorMsg, "API key")) {
			return "", fmt.Errorf("translation service requires an API key. Please set LIBRETRANSLATE_API_KEY environment variable or use a self-hosted instance. Visit https://portal.libretranslate.com to get an API key")
		}
		
		return "", fmt.Errorf("translation API returned status %d: %s", resp.StatusCode, errorMsg)
	}

	// Parse response
	var translateResp TranslateResponse
	if err := json.NewDecoder(resp.Body).Decode(&translateResp); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	return translateResp.TranslatedText, nil
}
