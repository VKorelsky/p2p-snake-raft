import { rtcConfig } from './config/local';
import type { Signaler } from './signaler';

// public API
// const conn = new PeerConnection(myPeerId, theirPeerId, signaler)
// if I received an offer
	// conn.respond(offer)
// if I am making an offer 
	// conn.initiate()

// conn.addEventListener("connected", (eventData) => { // handle })
// conn.addEventListener("message", (data) => { // handle })
// conn.sendMessage(<messageContents>)

class PeerConnection implements EventTarget {
	private selfId: string;
	private peerId: string;
	private connection: RTCPeerConnection;
	private dataChannel: RTCDataChannel | undefined;
	private signaler: Signaler;
	private connected: boolean = false;

	private constructor(selfId: string, peerId: string, signaler: Signaler) {
		this.selfId = selfId;
		this.peerId = peerId;
		this.signaler = signaler;
        this.connection = new RTCPeerConnection(rtcConfig)

        this.setupConnection();
	}

	public async respond(sessionDescription: RTCSessionDescription) {
        this.connection.setRemoteDescription(sessionDescription);
        const answer = await this.connection.createAnswer();
        await this.connection.setLocalDescription(answer);

        this.signaler.sendAnswer(this.peerId, answer);
    }

	public async initiate() {
        this.dataChannel = this.connection.createDataChannel(`${this.selfId} - ${this.peerId}`)
        
        const offer = await this.connection.createOffer();
        await this.connection.setLocalDescription(offer);

        this.dataChannel.addEventListener('open', (event) => {
			console.log('Channel open event:' + event);
			console.log('Channel object:' + this.dataChannel);
		});

        // bubble up the message event
		this.dataChannel.addEventListener('message', (event: any) => {
			console.log('Received new message event on data channel' + event);

			const message = event.data;
		});

		this.dataChannel.addEventListener('error', (e) => {
			console.log('Error on data channel' + e);
		});

        this.signaler.sendOffer(this.peerId, offer);
    }

	private setupConnection() {
		this.connection.addEventListener('connectionstatechange', () => {
			if (this.connection.connectionState === 'connected') {
				this.connected = true;
				// bubble up 
			}

			if (this.connection.connectionState === 'failed') {
                // bubble up 
			}
		});

		this.connection.addEventListener('icecandidateerror', () => {});

		this.connection.addEventListener('iceconnectionstatechange', () => {
			const state = this.connection.iceConnectionState;

			if (state === 'failed' || state === 'disconnected' || state === 'closed') {
				this.connected = false;
			}
		});

		this.connection.addEventListener('icecandidate', (event) => {
			if (event.candidate) {
				this.signaler.sendIceCandidate(this.peerId, event.candidate);
			}
		});

		this.connection.addEventListener('datachannel', (event: any) => {
			this.dataChannel = event.channel as RTCDataChannel;
			this.dataChannel.addEventListener('message', (event: any) => {
				const message = event.data;
                // bubble up the event 
                console.log(message)
			});
		});
	}
}
