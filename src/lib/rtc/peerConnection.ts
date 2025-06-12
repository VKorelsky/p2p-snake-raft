import type { Message } from '$lib/consensus/message';
import { TypedEventTarget } from '$lib/types';
import { rtcConfig } from '../config/local';
import type { newAnswerEvent, newIceCandidateEvent, Signaler } from './signaler';

interface PeerConnectionMap {
	"newMessage": CustomEvent<{
		peerId: string;
		message: Message;
	}>;
	"disconnected": CustomEvent<{ peerId: string; }>;
	"connectionEstablished": CustomEvent<{ peerId: string; }>;
	"connectionFailed": CustomEvent<{ peerId: string; }>;
	"iceCandidateSent": CustomEvent<{ peerId: string; candidate: RTCIceCandidate | null; }>;
	"iceCandidateReceived": CustomEvent<{ peerId: string; candidate: RTCIceCandidateInit | null; }>;
}

export type NewMessageEvent = PeerConnectionMap["newMessage"];
type DisconnectedEvent = PeerConnectionMap["disconnected"];
type ConnectionEstablishedEvent = PeerConnectionMap["connectionEstablished"];
type ConnectionFailedEvent = PeerConnectionMap["connectionFailed"];
type IceCandidateSentEvent = PeerConnectionMap["iceCandidateSent"];
type IceCandidateReceivedEvent = PeerConnectionMap["iceCandidateReceived"];


export class PeerConnection extends TypedEventTarget<PeerConnectionMap> {
	private selfId: string;
	private peerId: string;
	private connection: RTCPeerConnection;
	private dataChannel?: RTCDataChannel;
	private signaler: Signaler;

	public constructor(selfId: string, peerId: string, signaler: Signaler) {
		super();
		this.selfId = selfId;
		this.peerId = peerId;
		this.signaler = signaler;
		this.connection = new RTCPeerConnection(rtcConfig);

		this.setupConnection();
	}

	public isOpen() {
		return this.dataChannel?.readyState === 'open';
	}

	public getOtherPeerId() {
		return this.peerId;
	}

	public async initiateFrom(sessionDescription: RTCSessionDescription) {
		await this.connection.setRemoteDescription(sessionDescription);
		const answer = await this.connection.createAnswer();
		await this.connection.setLocalDescription(answer);

		this.connection.addEventListener('datachannel', (event: RTCDataChannelEvent) => {
			this.dataChannel = event.channel as RTCDataChannel;

			this.dataChannel.addEventListener('message', (event: MessageEvent) => {
				const newMessageEvent = new CustomEvent('newMessage', {
					detail: {
						peerId: this.peerId,
						message: event.data
					}
				});

				this.dispatchEvent(newMessageEvent);
			});
		});

		this.signaler.onNewIceCandidate(this.getNewIceCandidateHandler());
		this.signaler.sendAnswer(this.peerId, answer);
	}

	public async initiate() {
		this.dataChannel = this.connection.createDataChannel(`${this.selfId} - ${this.peerId}`);

		const offer = await this.connection.createOffer();
		await this.connection.setLocalDescription(offer);

		this.dataChannel.addEventListener('open', () => {});

		this.dataChannel.addEventListener('message', (event: MessageEvent) => {
			const newMessageEvent: NewMessageEvent = new CustomEvent('newMessage', {
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
		try {
			if (!(this.connection.connectionState === 'connected')) {
				throw new Error('Connection is not open');
			}
	
			if (!this.dataChannel) {
				throw new Error('No data channel open between the peers');
			}
	
			this.dataChannel.send(message);
		} catch (error) {
			console.log("Error sending message to peer. error: ", error)
		}
	}

	private setupConnection() {
		this.connection.addEventListener('connectionstatechange', () => {
			const connectionState = this.connection.connectionState;
			if (connectionState === 'connected') {
				const connectionEstablishedEvent: ConnectionEstablishedEvent = new CustomEvent('connectionEstablished', {
					detail: {
						peerId: this.peerId
					}
				});

				this.dispatchEvent(connectionEstablishedEvent);
			}

			if (connectionState === 'failed') {
				const connectionFailedEvent: ConnectionFailedEvent = new CustomEvent('connectionFailed', {
					detail: {
						peerId: this.peerId
					}
				});

				this.dispatchEvent(connectionFailedEvent);
			}

			if (connectionState === 'closed' || connectionState === 'disconnected') {
				const disconnectedEvent: DisconnectedEvent
				 = new CustomEvent('disconnected', {
					detail: {
						peerId: this.peerId
					}
				});

				this.dispatchEvent(disconnectedEvent);
			}
		});

		this.connection.addEventListener('icecandidateerror', (event) => {
			// console.log('ICE candidate error:', event);
		});

		this.connection.addEventListener('iceconnectionstatechange', (event) => {
			console.log('ICE connection state change:', event);
		});

		this.connection.addEventListener('icecandidate', (event) => {
			if (event.candidate) {
				console.log('New local ice candidate...');
				this.signaler.sendIceCandidate(this.peerId, event.candidate);

				// Dispatch iceCandidateSent event
				const iceCandidateSentEvent: IceCandidateSentEvent = new CustomEvent('iceCandidateSent', {
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
		return async (event: newIceCandidateEvent) => {
			if (event.fromPeerId === this.peerId) {
				await this.connection.addIceCandidate(event.newIceCandidate);

				// Dispatch iceCandidateReceived event
				const iceCandidateReceivedEvent: IceCandidateReceivedEvent = new CustomEvent('iceCandidateReceived', {
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
