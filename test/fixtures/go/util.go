package server

import "strings"

// Slugify converts text to a lowercase, hyphen-separated slug.
func Slugify(text string) string {
	lowered := strings.ToLower(strings.TrimSpace(text))
	return strings.ReplaceAll(lowered, " ", "-")
}

// RetryConfig controls retry behavior for FetchWithRetry.
type RetryConfig struct {
	Attempts int
	Delay    int
}

func FetchWithRetry(url string, cfg RetryConfig) (string, error) {
	var lastErr error
	for i := 0; i < cfg.Attempts; i++ {
		body, err := fetchOnce(url)
		if err == nil {
			return body, nil
		}
		lastErr = err
	}
	return "", lastErr
}

func fetchOnce(url string) (string, error) {
	return "", nil
}
