package ws

import "testing"

func TestVoiceLifecycleTransitionTable(t *testing.T) {
	testCases := []struct {
		name string
		from VoiceLifecycleState
		to   VoiceLifecycleState
		ok   bool
	}{
		{name: "not_in_voice_to_joining", from: VoiceLifecycleNotInVoice, to: VoiceLifecycleJoining, ok: true},
		{name: "joining_to_active", from: VoiceLifecycleJoining, to: VoiceLifecycleActive, ok: true},
		{name: "joining_to_leaving", from: VoiceLifecycleJoining, to: VoiceLifecycleLeaving, ok: true},
		{name: "active_to_leaving", from: VoiceLifecycleActive, to: VoiceLifecycleLeaving, ok: true},
		{name: "leaving_to_not_in_voice", from: VoiceLifecycleLeaving, to: VoiceLifecycleNotInVoice, ok: true},
		{name: "active_to_joining_invalid", from: VoiceLifecycleActive, to: VoiceLifecycleJoining, ok: false},
		{name: "not_in_voice_to_active_invalid", from: VoiceLifecycleNotInVoice, to: VoiceLifecycleActive, ok: false},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isValidVoiceTransition(tc.from, tc.to); got != tc.ok {
				t.Fatalf("expected %v, got %v for transition %s -> %s", tc.ok, got, tc.from, tc.to)
			}
		})
	}
}

func TestBeginJoinActivateAndLeave(t *testing.T) {
	h := &Hub{voiceSessions: make(map[string]*VoiceSession)}

	if err := h.BeginVoiceJoin("usr_1", true, false); err != nil {
		t.Fatalf("BeginVoiceJoin failed: %v", err)
	}

	state := h.GetVoiceLifecycleState("usr_1")
	if state != VoiceLifecycleJoining {
		t.Fatalf("expected joining state, got %s", state)
	}

	voiceState, err := h.ActivateVoiceSession("usr_1")
	if err != nil {
		t.Fatalf("ActivateVoiceSession failed: %v", err)
	}
	if !voiceState.Muted || voiceState.Deafened {
		t.Fatalf("unexpected active voice state: %+v", voiceState)
	}

	_, removed := h.RemoveUserFromVoice("usr_1")
	if !removed {
		t.Fatal("expected RemoveUserFromVoice to remove active session")
	}

	if state := h.GetVoiceLifecycleState("usr_1"); state != VoiceLifecycleNotInVoice {
		t.Fatalf("expected not_in_voice state after remove, got %s", state)
	}
}

func TestInvalidJoinFromActiveState(t *testing.T) {
	h := &Hub{voiceSessions: make(map[string]*VoiceSession)}

	if err := h.BeginVoiceJoin("usr_1", false, false); err != nil {
		t.Fatalf("initial BeginVoiceJoin failed: %v", err)
	}

	if _, err := h.ActivateVoiceSession("usr_1"); err != nil {
		t.Fatalf("ActivateVoiceSession failed: %v", err)
	}

	if err := h.BeginVoiceJoin("usr_1", false, false); err == nil {
		t.Fatal("expected BeginVoiceJoin to fail when already active")
	}
}
