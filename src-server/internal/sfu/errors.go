package sfu

import "errors"

// ErrorKind categorizes SFU errors for appropriate handling
type ErrorKind int

const (
	// ErrKindFatal indicates an unrecoverable error requiring peer removal
	ErrKindFatal ErrorKind = iota
	// ErrKindTransient indicates a potentially recoverable error
	ErrKindTransient
	// ErrKindPeerClosed indicates normal closure, no action needed
	ErrKindPeerClosed
)

// PeerError wraps errors with context about the peer and operation
type PeerError struct {
	Kind   ErrorKind
	PeerID string
	Op     string
	Err    error
}

func (e *PeerError) Error() string {
	if e.Err == nil {
		return e.Op + " failed for peer " + e.PeerID
	}
	return e.Op + " failed for peer " + e.PeerID + ": " + e.Err.Error()
}

func (e *PeerError) Unwrap() error {
	return e.Err
}

// Sentinel errors
var (
	ErrPeerNotFound  = errors.New("peer not found")
	ErrPeerNotActive = errors.New("peer not in active state")
)

// NewFatalError creates a fatal error that requires peer cleanup
func NewFatalError(peerID, op string, err error) *PeerError {
	return &PeerError{Kind: ErrKindFatal, PeerID: peerID, Op: op, Err: err}
}

// NewTransientError creates a transient error that may be retried
func NewTransientError(peerID, op string, err error) *PeerError {
	return &PeerError{Kind: ErrKindTransient, PeerID: peerID, Op: op, Err: err}
}

// NewPeerClosedError creates an error indicating normal peer closure
func NewPeerClosedError(peerID, op string) *PeerError {
	return &PeerError{Kind: ErrKindPeerClosed, PeerID: peerID, Op: op, Err: ErrPeerNotActive}
}
