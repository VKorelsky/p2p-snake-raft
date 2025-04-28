import { rtcConfig } from './config/local';
import type { newAnswerEvent, newIceCandidateEvent, Signaler } from './signaler';

// events defined
// "connectionEstablished"
// "connectionFailed"
// "iceCandidateSent"
// "iceCandidateReceived"
// "newMessage"
// "disconnected"

export class PeerConnection extends EventTarget {
	private selfId: string;
	private peerId: string;
	private connection: RTCPeerConnection;
	private dataChannel: RTCDataChannel | undefined;
	private signaler: Signaler;

	public constructor(selfId: string, peerId: string, signaler: Signaler) {
		super();
		this.selfId = selfId;
		this.peerId = peerId;
		this.signaler = signaler;
		this.connection = new RTCPeerConnection(rtcConfig);

		this.setupConnection();
	}

	public getOtherPeerId() {
		return this.peerId;
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
						peerId: this.peerId,
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

		// TODO perhaps it's here that we should be setting the initiate connection to true
		this.dataChannel.addEventListener('open', (event) => {
			console.log('Channel open event:' + event);
			console.log('Channel object:' + this.dataChannel);
		});

		this.dataChannel.addEventListener('message', (event: MessageEvent) => {
			console.log('Received new message event on data channel' + event);

			const newMessageEvent = new CustomEvent('newMessage', {
				detail: {
					peerId: this.peerId,
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

	public close() {
		if (this.dataChannel) {
			this.dataChannel.close();
		}

		if (this.connection) {
			this.connection.close();
		}
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
				const connectionFailedEvent = new CustomEvent('connectionFailed', {
					detail: {
						peerId: this.peerId
					}
				});

				this.dispatchEvent(connectionFailedEvent);
			}

			if (this.connection.connectionState === 'closed') {
				const disconnectedEvent = new CustomEvent('disconnected', {
					detail: {
						peerId: this.peerId
					}
				});

				this.dispatchEvent(disconnectedEvent);
			}
		});

		this.connection.addEventListener('icecandidateerror', () => {});

		this.connection.addEventListener('iceconnectionstatechange', () => {});

		this.connection.addEventListener('icecandidate', (event) => {
			if (event.candidate) {
				this.signaler.sendIceCandidate(this.peerId, event.candidate);

				// Dispatch iceCandidateSent event
				const iceCandidateSentEvent = new CustomEvent('iceCandidateSent', {
					detail: {
						peerId: this.peerId,
						candidate: event.candidate
					}
				});
				this.dispatchEvent(iceCandidateSentEvent);
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

				// Dispatch iceCandidateReceived event
				const iceCandidateReceivedEvent = new CustomEvent('iceCandidateReceived', {
					detail: {
						peerId: this.peerId,
						candidate: event.newIceCandidate
					}
				});
				this.dispatchEvent(iceCandidateReceivedEvent);
			}
		};
	}
}
