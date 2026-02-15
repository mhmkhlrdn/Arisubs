package handlers

import (
	"arisubs/backend/services"
	"net/http"

	"github.com/gin-gonic/gin"
)

type TranslationHandler struct {
	translationService *services.TranslationService
}

func NewTranslationHandler(translationService *services.TranslationService) *TranslationHandler {
	return &TranslationHandler{
		translationService: translationService,
	}
}

type TranslateRequest struct {
	Text           string `json:"text" binding:"required"`
	SourceLanguage string `json:"sourceLanguage" binding:"required"`
	TargetLanguage string `json:"targetLanguage" binding:"required"`
}

type TranslateResponse struct {
	TranslatedText string `json:"translatedText"`
}

/*
 * [Translate]
 * - Translate the text
 */
func (h *TranslationHandler) Translate(c *gin.Context) {
	var req TranslateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body", "details": err.Error()})
		return
	}

	if req.Text == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Text cannot be empty"})
		return
	}

	translatedText, err := h.translationService.Translate(req.Text, req.SourceLanguage, req.TargetLanguage)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Translation failed", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, TranslateResponse{
		TranslatedText: translatedText,
	})
}
