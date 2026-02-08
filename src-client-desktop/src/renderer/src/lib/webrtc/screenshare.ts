import { createLogger } from "../logger"
import { wsManager } from "../ws"
import { VIDEO_MAX_BITRATE_BPS, VIDEO_NETWORK_PRIORITY, VIDEO_PRIORITY } from "./constants"

const log = createLogger("ScreenShare")

type RemoteStreamCallback = (stream: MediaStream | null, streamerId: string | null) => void

class ScreenShareManager {
  private peerConnection: RTCPeerConnection | null = null
  private localVideoTrack: MediaStreamTrack | null = null
  private localStream: MediaStream | null = null
  private remoteStreamCallback: RemoteStreamCallback | null = null
  private currentViewingStreamerId: string | null = null
  private videoSender: RTCRtpSender | null = null

  setPeerConnection(pc: RTCPeerConnection | null): void {
    this.peerConnection = pc
    // Reset video sender when peer connection changes
    this.videoSender = null
  }

  /**
   * Initialize the video sender from existing transceiver.
   * Call this after the initial offer/answer is complete.
   * The server creates a sendrecv video transceiver in its initial offer,
   * so we can reuse it with replaceTrack() instead of addTrack().
   * This avoids client-initiated renegotiation which causes DTLS role conflicts.
   */
  initializeVideoSender(): void {
    if (!this.peerConnection || this.videoSender) {
      return
    }

    // Find the video transceiver created by the server's initial offer
    // The transceiver's receiver will have kind="video" even if no track is assigned yet
    const transceivers = this.peerConnection.getTransceivers()
    for (const transceiver of transceivers) {
      // Check the receiver's track kind - this is set even before data arrives
      // The mid will be "1" for video (after "0" for audio) based on server's offer order
      const receiverTrack = transceiver.receiver.track
      if (receiverTrack && receiverTrack.kind === "video") {
        this.videoSender = transceiver.sender
        log.info(
          `Initialized video sender from existing transceiver (mid=${transceiver.mid}, direction=${transceiver.direction})`
        )
        return
      }
    }

    log.warn("No existing video transceiver found - screen share will require renegotiation")
  }

  onRemoteStream(callback: RemoteStreamCallback): void {
    this.remoteStreamCallback = callback
  }

  /**
   * Start sharing screen with the selected source
   *
   * Uses replaceTrack() pattern to avoid transceiver state corruption:
   * - First share: addTrack() creates transceiver, triggers negotiation
   * - Subsequent shares: replaceTrack() reuses sender, no renegotiation needed
   */
  async startShare(sourceId: string): Promise<void> {
    if (!this.peerConnection) {
      throw new Error("Not connected to voice")
    }

    if (this.localVideoTrack) {
      return // Already sharing
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: sourceId,
            maxFrameRate: 60,
            maxWidth: 1920,
            maxHeight: 1080
          }
        } as MediaTrackConstraints
      })

      this.localStream = stream
      this.localVideoTrack = stream.getVideoTracks()[0]

      if (!this.localVideoTrack) {
        throw new Error("No video track in captured stream")
      }

      this.localVideoTrack.onended = () => this.stopShare()

      wsManager.startScreenShare()

      if (this.videoSender) {
        // Reuse existing sender with replaceTrack - no client-initiated renegotiation
        await this.videoSender.replaceTrack(this.localVideoTrack)

        // CRITICAL: Change transceiver direction from recvonly to sendrecv
        // Without this, the answer SDP will say recvonly and server won't expect video
        const transceivers = this.peerConnection.getTransceivers()
        for (const transceiver of transceivers) {
          if (transceiver.sender === this.videoSender) {
            transceiver.direction = "sendrecv"
            log.info(`Set video transceiver direction to sendrecv`)
            break
          }
        }

        // Signal server that track is ready - server will initiate renegotiation
        // This triggers OnTrack on server side while maintaining correct DTLS roles
        wsManager.screenShareReady()
      } else {
        // First time - creates transceiver, triggers negotiation
        this.videoSender = this.peerConnection.addTrack(this.localVideoTrack, stream)
        // For addTrack(), the negotiationneeded event will trigger client offer
        // which the server will handle normally
      }

      // Apply low priority and bandwidth cap to video sender
      // This ensures voice chat takes precedence under bandwidth contention
      try {
        const params = this.videoSender.getParameters()
        if (params.encodings && params.encodings.length > 0) {
          params.encodings[0].maxBitrate = VIDEO_MAX_BITRATE_BPS
          params.encodings[0].priority = VIDEO_PRIORITY
          params.encodings[0].networkPriority = VIDEO_NETWORK_PRIORITY
        }
        // Degrade resolution first, maintain framerate for smooth motion
        params.degradationPreference = "maintain-framerate"
        await this.videoSender.setParameters(params)
        log.info("Applied video priority and bandwidth settings")
      } catch (err) {
        log.warn("Could not set video parameters:", err)
      }

      log.info("Screen share started")
    } catch (err) {
      log.error("Failed to start screen share:", err)
      this.cleanup()
      throw err
    }
  }

  /**
   * Stop sharing screen
   *
   * Uses replaceTrack(null) to keep sender/transceiver intact for reuse.
   * This avoids transceiver state corruption from removeTrack().
   */
  stopShare(): void {
    if (!this.localVideoTrack) {
      return
    }

    wsManager.stopScreenShare()

    // Replace with null - keeps sender/transceiver intact for reuse
    // Direction stays sendrecv to avoid onnegotiationneeded firing,
    // which would cause a DTLS role conflict (client offer vs server-established roles)
    if (this.videoSender) {
      this.videoSender.replaceTrack(null)
    }

    this.localVideoTrack.stop()
    this.localVideoTrack = null

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop()
      }
      this.localStream = null
    }

    log.info("Screen share stopped")
  }

  subscribeToStream(streamerId: string): void {
    if (this.currentViewingStreamerId === streamerId) {
      return
    }

    this.currentViewingStreamerId = streamerId
    wsManager.subscribeScreenShare(streamerId)
    log.info(`Subscribed to ${streamerId}'s stream`)
  }

  unsubscribe(): void {
    if (!this.currentViewingStreamerId) {
      return
    }

    wsManager.unsubscribeScreenShare()
    this.currentViewingStreamerId = null

    // Notify callback that stream is gone
    if (this.remoteStreamCallback) {
      this.remoteStreamCallback(null, null)
    }

    log.info("Unsubscribed from stream")
  }

  /** Clears local state without sending unsubscribe (server already cleaned up). */
  onStreamerStopped(streamerId: string): void {
    if (this.currentViewingStreamerId !== streamerId) {
      return
    }

    this.currentViewingStreamerId = null
    log.info(`Streamer ${streamerId} stopped, cleared viewing state`)
  }

  handleRemoteVideoTrack(track: MediaStreamTrack, streamId: string): void {
    // streamId is the user ID of the streamer
    if (this.currentViewingStreamerId !== streamId) {
      log.info(`Received video track from ${streamId} but not subscribed`)
      return
    }

    const stream = new MediaStream([track])

    if (this.remoteStreamCallback) {
      this.remoteStreamCallback(stream, streamId)
    }

    // Handle track ending
    track.onended = () => {
      log.info("Remote video track ended")
      if (this.remoteStreamCallback && this.currentViewingStreamerId === streamId) {
        this.remoteStreamCallback(null, null)
      }
    }

    log.info(`Receiving video stream from ${streamId}`)
  }

  onVoiceStopped(): void {
    this.cleanup()
    this.unsubscribe()
    this.peerConnection = null
    this.videoSender = null // Reset for next voice session
  }

  getViewingStreamerId(): string | null {
    return this.currentViewingStreamerId
  }

  getLocalStream(): MediaStream | null {
    return this.localStream
  }

  private cleanup(): void {
    if (this.localVideoTrack) {
      this.localVideoTrack.stop()
      this.localVideoTrack = null
    }

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop()
      }
      this.localStream = null
    }
  }
}

export const screenShareManager = new ScreenShareManager()
export { ScreenShareManager }
