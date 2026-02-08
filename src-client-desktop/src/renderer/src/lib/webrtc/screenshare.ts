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
  private pendingVideoTrack: MediaStreamTrack | null = null

  setPeerConnection(pc: RTCPeerConnection | null): void {
    this.peerConnection = pc
    // Reset video sender when peer connection changes
    this.videoSender = null
  }

  hasPendingTrack(): boolean {
    return this.pendingVideoTrack !== null
  }

  /**
   * Activate a pending screen share after server-triggered renegotiation.
   * Finds the video transceiver, sets direction to sendrecv, attaches the track,
   * and applies video parameters.
   */
  async activatePendingShare(): Promise<void> {
    if (!this.peerConnection || !this.pendingVideoTrack) {
      return
    }

    const transceivers = this.peerConnection.getTransceivers()
    let videoTransceiver: RTCRtpTransceiver | null = null
    for (const t of transceivers) {
      if (t.receiver.track?.kind === "video") {
        videoTransceiver = t
        break
      }
    }

    if (!videoTransceiver) {
      log.error("No video transceiver found during activatePendingShare")
      return
    }

    videoTransceiver.direction = "sendrecv"
    this.videoSender = videoTransceiver.sender
    await this.videoSender.replaceTrack(this.pendingVideoTrack)
    log.info("Activated pending screen share track")

    // Apply video bitrate/priority parameters
    try {
      const params = this.videoSender.getParameters()
      if (params.encodings && params.encodings.length > 0) {
        params.encodings[0].maxBitrate = VIDEO_MAX_BITRATE_BPS
        params.encodings[0].priority = VIDEO_PRIORITY
        params.encodings[0].networkPriority = VIDEO_NETWORK_PRIORITY
      }
      params.degradationPreference = "maintain-framerate"
      await this.videoSender.setParameters(params)
      log.info("Applied video priority and bandwidth settings")
    } catch (err) {
      log.warn("Could not set video parameters:", err)
    }

    this.pendingVideoTrack = null
  }

  onRemoteStream(callback: RemoteStreamCallback): void {
    this.remoteStreamCallback = callback
  }

  /**
   * Start sharing screen with the selected source.
   *
   * Two paths:
   * - First share (videoSender null): capture track, store as pending, send WS start.
   *   Server triggers renegotiation → handleOffer calls activatePendingShare().
   * - Subsequent shares (videoSender set): direct replaceTrack, no renegotiation.
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

      if (this.videoSender) {
        // Subsequent share: reuse existing sender, no renegotiation needed
        await this.videoSender.replaceTrack(this.localVideoTrack)

        // Apply video bitrate/priority parameters
        try {
          const params = this.videoSender.getParameters()
          if (params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = VIDEO_MAX_BITRATE_BPS
            params.encodings[0].priority = VIDEO_PRIORITY
            params.encodings[0].networkPriority = VIDEO_NETWORK_PRIORITY
          }
          params.degradationPreference = "maintain-framerate"
          await this.videoSender.setParameters(params)
          log.info("Applied video priority and bandwidth settings")
        } catch (err) {
          log.warn("Could not set video parameters:", err)
        }

        wsManager.startScreenShare()
      } else {
        // First share: store track as pending, server will trigger renegotiation
        this.pendingVideoTrack = this.localVideoTrack
        wsManager.startScreenShare()
        log.info("Stored pending video track, waiting for server renegotiation")
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
    this.pendingVideoTrack = null
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

    this.pendingVideoTrack = null
  }
}

export const screenShareManager = new ScreenShareManager()
export { ScreenShareManager }
