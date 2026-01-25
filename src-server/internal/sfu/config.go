package sfu

import "github.com/pion/webrtc/v4"

// Config holds SFU configuration
type Config struct {
	// PublicIP is the public IP address for ICE candidates (empty for auto-detect)
	PublicIP string
	// MinPort for WebRTC UDP ports
	MinPort uint16
	// MaxPort for WebRTC UDP ports
	MaxPort uint16
	// STUNUrl for server-side candidate gathering (e.g. "stun:turn.myserver.com:3478")
	STUNUrl string
}

// ToWebRTCConfig builds the pion configuration for server-side peer connections.
// The SFU only needs STUN for candidate gathering; TURN is unnecessary since
// the SFU has a public IP.
func (c *Config) ToWebRTCConfig() webrtc.Configuration {
	if c.STUNUrl == "" {
		return webrtc.Configuration{}
	}
	return webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{c.STUNUrl}},
		},
	}
}

// Signaling payload types used by SFU callbacks

type RtcOfferPayload struct {
	SDP string `json:"sdp"`
}

type RtcIceCandidatePayload struct {
	Candidate     string  `json:"candidate"`
	SDPMid        *string `json:"sdpMid,omitempty"`
	SDPMLineIndex *uint16 `json:"sdpMLineIndex,omitempty"`
}
