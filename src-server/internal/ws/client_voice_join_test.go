package ws

import (
	"testing"

	"lobby/internal/models"
)

func TestHandleVoiceJoinDoesNotBroadcastInVoiceBeforeActivation(t *testing.T) {
	h := &Hub{
		voiceSessions: make(map[string]*VoiceSession),
		userClients:   make(map[string]*Client),
		broadcast:     make(chan *WSMessage, 4),
	}

	c := NewClient(h, nil)
	c.user = &models.User{ID: "usr_1"}
	c.state.Store(int32(ClientStateIdentified))

	c.handleVoiceJoin(&WSMessage{
		Op:   OpDispatch,
		Type: CmdVoiceJoin,
		Data: map[string]interface{}{
			"muted":    false,
			"deafened": false,
		},
	})

	if got := h.GetVoiceLifecycleState("usr_1"); got != VoiceLifecycleJoining {
		t.Fatalf("expected voice lifecycle state %q, got %q", VoiceLifecycleJoining, got)
	}

	select {
	case msg := <-h.broadcast:
		t.Fatalf("unexpected broadcast during join setup: type=%s", msg.Type)
	default:
	}
}
