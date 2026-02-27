package main

import (
	"arisubs/backend/services"
	"encoding/json"
	"fmt"
	"log"
)

func main() {
	// Let's use a sample YouTube stream URL that has live chat replay
	// "https://www.youtube.com/watch?v=5qap5aO4i9A" (Lofi girl - just as an example)
	// We'll pass a URL as an argument
	url := "https://www.youtube.com/watch?v=5qap5aO4i9A"

	analyze := services.NewAnalyzeService()
	log.Printf("Analyzing stream: %s", url)

	moments, err := analyze.AnalyzeStream(url, 0)
	if err != nil {
		log.Fatalf("Error: %v", err)
	}

	out, _ := json.MarshalIndent(moments, "", "  ")
	fmt.Printf("Found %d moments:\n%s\n", len(moments), out)
}
