// Package server implements a minimal HTTP API for the widget service.
package server

import (
	"encoding/json"
	"net/http"
)

// Widget represents a single item in the catalog.
type Widget struct {
	ID    string
	Name  string
	Price float64
}

// Store defines the persistence contract for widgets.
type Store interface {
	Get(id string) (*Widget, error)
	Save(w *Widget) error
}

// Server handles incoming HTTP requests for widgets.
type Server struct {
	store Store
}

// NewServer constructs a Server backed by the given Store.
func NewServer(store Store) *Server {
	return &Server{store: store}
}

// ServeHTTP dispatches a request to the appropriate handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	widget, err := s.store.Get(r.URL.Query().Get("id"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(widget)
}

func computeDiscount(price float64) float64 {
	if price > 100 {
		return price * 0.9
	}
	return price
}
