import type { Message } from '$lib/consensus/message';
import { TypedEventTarget } from '$lib/types';
import { rtcConfig } from '../config/local';
import type { NewAnswerEvent, NewIceCandidateEvent, Signaler } from './signaler';

interface PeerConnectionEventMap {
	newMessage: CustomEvent<{
		peerId: string;
		message: Message;
	}>;
	disconnected: CustomEvent<{ peerId: string }>;
	connectionEstablished: CustomEvent<{ peerId: string }>;
	connectionFailed: CustomEvent<{ peerId: string }>;
	iceCandidateSent: CustomEvent<{ peerId: string; candidate: RTCIceCandidate | null }>;
	iceCandidateReceived: CustomEvent<{ peerId: string; candidate: RTCIceCandidateInit | null }>;
}

export type NewMessageEvent = PeerConnectionEventMap['newMessage'];
export type ConnectionDisconnectedEvent = PeerConnectionEventMap['disconnected'];
export type ConnectionEstablishedEvent = PeerConnectionEventMap['connectionEstablished'];
export type ConnectionFailedEvent = PeerConnectionEventMap['connectionFailed'];
export type IceCandidateSentEvent = PeerConnectionEventMap['iceCandidateSent'];
export type IceCandidateReceivedEvent = PeerConnectionEventMap['iceCandidateReceived'];

export class PeerConnection extends TypedEventTarget<PeerConnectionEventMap> {
	private selfId: string;
	private peerId: string;
	private connection: RTCPeerConnection;
	private dataChannel?: RTCDataChannel;
	private signaler: Signaler;
	private boundConnectionStateChangeHandler: (event: Event) => void;
	private boundIceCandidateErrorHandler: (event: RTCPeerConnectionIceErrorEvent) => void;
	private boundDataChannelEventHandler: (event: RTCDataChannelEvent) => void;
	private boundIceConnectionStateChangeHandler: (event: Event) => void;
	private boundIceCandidateEventHandler: (event: RTCPeerConnectionIceEvent) => void;
	private boundNewAnswerHandler: (event: NewAnswerEvent) => void;
	private boundNewIceCandidateHandler: (event: NewIceCandidateEvent) => Promise<void>;

	public constructor(selfId: string, peerId: string, signaler: Signaler) {
		super();
		this.selfId = selfId;
		this.peerId = peerId;
		this.signaler = signaler;
		this.connection = new RTCPeerConnection(rtcConfig);
		this.boundConnectionStateChangeHandler = this.connectionStateChangeHandler.bind(this);
		this.boundIceCandidateErrorHandler = this.iceCandidateErrorHandler.bind(this);
		this.boundDataChannelEventHandler = this.dataChannelEventHandler.bind(this);
		this.boundIceConnectionStateChangeHandler = this.iceConnectionStateChangeHandler.bind(this);
		this.boundIceCandidateEventHandler = this.iceCandidateEventHandler.bind(this);
		this.boundNewAnswerHandler = this.newAnswerHandler.bind(this);
		this.boundNewIceCandidateHandler = this.newIceCandidateHandler.bind(this);

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

		this.connection.addEventListener('datachannel', this.boundDataChannelEventHandler);

		this.signaler.onNewIceCandidate(this.boundNewIceCandidateHandler);
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

		this.signaler.onNewAnswer(this.boundNewAnswerHandler);
		this.signaler.onNewIceCandidate(this.boundNewIceCandidateHandler);

		this.signaler.sendOffer(this.peerId, offer);
	}

	public close() {
		this.connection.removeEventListener(
			'connectionstatechange',
			this.boundConnectionStateChangeHandler
		);
		this.connection.removeEventListener('icecandidate', this.boundIceCandidateEventHandler);
		this.connection.removeEventListener('datachannel', this.boundDataChannelEventHandler);

		if (this.dataChannel) {
			this.dataChannel.close();
			this.dataChannel = undefined;
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
			console.log('Error sending message to peer. error: ', error);
		}
	}

	private setupConnection() {
		this.connection.addEventListener(
			'connectionstatechange',
			this.boundConnectionStateChangeHandler
		);
		this.connection.addEventListener('icecandidateerror', this.boundIceCandidateErrorHandler);
		this.connection.addEventListener(
			'iceconnectionstatechange',
			this.boundIceConnectionStateChangeHandler
		);
		this.connection.addEventListener('icecandidate', this.boundIceCandidateEventHandler);
	}

	private iceCandidateErrorHandler(event: RTCPeerConnectionIceErrorEvent) {
		console.log('ICE candidate error:', event);
	}

	private dataChannelEventHandler(event: RTCDataChannelEvent) {
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
	}

	private iceConnectionStateChangeHandler(event: Event) {
		console.log('ICE connection state change:', event);
	}

	private iceCandidateEventHandler(event: RTCPeerConnectionIceEvent) {
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
	}

	private connectionStateChangeHandler() {
		const connectionState = this.connection.connectionState;
		if (connectionState === 'connected') {
			const connectionEstablishedEvent: ConnectionEstablishedEvent = new CustomEvent(
				'connectionEstablished',
				{
					detail: {
						peerId: this.peerId
					}
				}
			);

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
			const disconnectedEvent: ConnectionDisconnectedEvent = new CustomEvent('disconnected', {
				detail: {
					peerId: this.peerId
				}
			});

			this.dispatchEvent(disconnectedEvent);
		}
	}

	private async newAnswerHandler(event: NewAnswerEvent) {
		if (event.fromPeerId === this.peerId) {
			const remotePeerDescription = new RTCSessionDescription(event.answer);
			await this.connection.setRemoteDescription(remotePeerDescription);
		}
	}

	private async newIceCandidateHandler(event: NewIceCandidateEvent) {
		if (event.fromPeerId === this.peerId) {
			await this.connection.addIceCandidate(event.newIceCandidate);

			// Dispatch iceCandidateReceived event
			const iceCandidateReceivedEvent: IceCandidateReceivedEvent = new CustomEvent(
				'iceCandidateReceived',
				{
					detail: {
						peerId: this.peerId,
						candidate: event.newIceCandidate
					}
				}
			);
			this.dispatchEvent(iceCandidateReceivedEvent);
		}
	}
}
