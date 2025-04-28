import { rtcConfig } from './config/local';
import type { newAnswerEvent, newIceCandidateEvent, Signaler } from './signaler';

// events defined
// "connectionEstablished"
// "connectionFailed"
// "newMessage"
// "disconnected"

class PeerConnection extends EventTarget {
	private selfId: string;
	private peerId: string;
	private connection: RTCPeerConnection;
	private dataChannel: RTCDataChannel | undefined;
	private signaler: Signaler;

	private constructor(selfId: string, peerId: string, signaler: Signaler) {
		super();
		this.selfId = selfId;
		this.peerId = peerId;
		this.signaler = signaler;
		this.connection = new RTCPeerConnection(rtcConfig);

		this.setupConnection();
	}

	public async respond(sessionDescription: RTCSessionDescription) {
		this.connection.setRemoteDescription(sessionDescription);
		const answer = await this.connection.createAnswer();
		await this.connection.setLocalDescription(answer);

		this.connection.addEventListener('datachannel', (event: RTCDataChannelEvent) => {
			this.dataChannel = event.channel as RTCDataChannel;
			this.dataChannel.addEventListener('message', (event: MessageEvent) => {
				console.log('Received new message event on data channel' + event);

				const newMessageEvent = new CustomEvent('newMessage', {
					detail: {
						message: event.data
					}
				});
	
				this.dispatchEvent(newMessageEvent);
			});
		});

		this.signaler.sendAnswer(this.peerId, answer);
	}

	public async initiate() {
		this.dataChannel = this.connection.createDataChannel(`${this.selfId} - ${this.peerId}`);

		const offer = await this.connection.createOffer();
		await this.connection.setLocalDescription(offer);

		this.dataChannel.addEventListener('open', (event) => {
			console.log('Channel open event:' + event);
			console.log('Channel object:' + this.dataChannel);
		});

		this.dataChannel.addEventListener('message', (event: MessageEvent) => {
			console.log('Received new message event on data channel' + event);

			const newMessageEvent = new CustomEvent('newMessage', {
				detail: {
					message: event.data
				}
			});

			this.dispatchEvent(newMessageEvent);
		});

		this.dataChannel.addEventListener('error', (e) => {
			console.log('Error on data channel' + e);
		});

		this.signaler.onNewAnswer(this.getNewAnswerHandler());
		this.signaler.onNewIceCandidate(this.getNewIceCandidateHandler());

		this.signaler.sendOffer(this.peerId, offer);
	}

	public sendMessage(message: string) {
		if (!(this.connection.connectionState === 'connected')) {
			throw new Error('Connection is not open');
		}

		if (!this.dataChannel) {
			throw new Error('No data channel open between the peers');
		}

		console.log('Sending message from ' + this);
		this.dataChannel.send(message);
	}

	private setupConnection() {
		this.connection.addEventListener('connectionstatechange', () => {
			if (this.connection.connectionState === 'connected') {
				const connectionEstablishedEvent = new CustomEvent('connectionEstablished', {
					detail: {
						peerId: this.peerId
					}
				});

				this.dispatchEvent(connectionEstablishedEvent);
			}

			if (this.connection.connectionState === 'failed') {
				const connectionFailedEvent = new CustomEvent('connectionFailedEvent', {
					detail: {
						peerId: this.peerId
					}
				});

				this.dispatchEvent(connectionFailedEvent);
			}
		});

		this.connection.addEventListener('icecandidateerror', () => {});

		this.connection.addEventListener('iceconnectionstatechange', () => {});

		this.connection.addEventListener('icecandidate', (event) => {
			if (event.candidate) {
				this.signaler.sendIceCandidate(this.peerId, event.candidate);
			}
		});
	}

	private getNewAnswerHandler() {
		return async (event: newAnswerEvent) => {
			if (event.fromPeerId === this.peerId) {
				const remotePeerDescription = new RTCSessionDescription(event.answer);
				await this.connection.setRemoteDescription(remotePeerDescription);
			}
		};
	}

	private getNewIceCandidateHandler() {
		return (event: newIceCandidateEvent) => {
			if (event.fromPeerId === this.peerId) {
				this.connection.addIceCandidate(event.newIceCandidate);
			}
		};
	}
}
