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
	private boundDataChannelMessageHandler: (event: MessageEvent) => void;
	private boundDataChannelErrorHandeler: (event: RTCErrorEvent) => void;
	private boundDataChannelStateChangeHandler: () => void;

	private iceRestartCount = 0;

	public constructor(selfId: string, peerId: string, signaler: Signaler) {
		super();
		this.selfId = selfId;
		this.peerId = peerId;
		this.signaler = signaler;
		this.connection = new RTCPeerConnection(rtcConfig);
		
		this.boundConnectionStateChangeHandler = this.connectionStateChangeHandler.bind(this);
		this.boundIceCandidateErrorHandler = this.iceCandidateErrorHandler.bind(this);
		this.boundDataChannelEventHandler = this.dataChannelEventHandler.bind(this);
		this.boundDataChannelMessageHandler = this.dataChannelMessageHandler.bind(this);
		this.boundIceConnectionStateChangeHandler = this.iceConnectionStateChangeHandler.bind(this);
		this.boundIceCandidateEventHandler = this.iceCandidateEventHandler.bind(this);
		this.boundNewAnswerHandler = this.newAnswerHandler.bind(this);
		this.boundNewIceCandidateHandler = this.newIceCandidateHandler.bind(this);
		this.boundDataChannelErrorHandeler = this.dataChannelErrorHandler.bind(this);
		this.boundDataChannelStateChangeHandler = this.dataChannelStateChangeHandler.bind(this);

		this.setupConnection();
	}

	public isOpen() {
		return this.dataChannel?.readyState === 'open';
	}

	public getOtherPeerId() {
		return this.peerId;
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

	public async initiateFrom(sessionDescription: RTCSessionDescription) {
		try {
			await this.connection.setRemoteDescription(sessionDescription);
			const answer = await this.connection.createAnswer();
			await this.connection.setLocalDescription(answer);

			this.connection.addEventListener('datachannel', this.boundDataChannelEventHandler);
			this.signaler.onNewIceCandidate(this.boundNewIceCandidateHandler);
			this.signaler.sendAnswer(this.peerId, answer);
		} catch (error) {
			console.warn(`[PEERCONNECTION] Failed to send message to peer ${this.peerId}:`, error);
			const disconnectedEvent = new CustomEvent('disconnected', { detail: { peerId: this.peerId } });
			this.dispatchEvent(disconnectedEvent);
			throw error;
		}
	}

	public async initiate() {
		try {
			this.dataChannel = this.connection.createDataChannel(`${this.selfId} - ${this.peerId}`);

			const offer = await this.connection.createOffer();
			await this.connection.setLocalDescription(offer);

			this.dataChannel.addEventListener('open', () => this.boundDataChannelStateChangeHandler);
			this.dataChannel.addEventListener('close', () => this.boundDataChannelStateChangeHandler);
			this.dataChannel.addEventListener('message', this.boundDataChannelMessageHandler);
			this.dataChannel.addEventListener('error', this.boundDataChannelErrorHandeler);

			this.signaler.onNewAnswer(this.boundNewAnswerHandler);
			this.signaler.onNewIceCandidate(this.boundNewIceCandidateHandler);

			this.signaler.sendOffer(this.peerId, offer);
		} catch (error) {
			console.error(`[PEERCONNECTION] Error initiating connection ${error}`);
		}
	}

	public close() {
		this.dataChannel?.removeEventListener('message', this.boundDataChannelMessageHandler);
		this.dataChannel?.removeEventListener('error', this.boundDataChannelErrorHandeler);
		this.connection.removeEventListener('datachannel', this.boundDataChannelEventHandler);
		this.connection.removeEventListener(
			'connectionstatechange',
			this.boundConnectionStateChangeHandler
		);
		this.connection.removeEventListener('icecandidate', this.boundIceCandidateEventHandler);
		this.connection.removeEventListener('icecandidateerror', this.boundIceCandidateErrorHandler);
		this.connection.removeEventListener(
			'iceconnectionstatechange',
			this.boundIceConnectionStateChangeHandler
		);

		if (this.dataChannel) {
			this.dataChannel.close();
			this.dataChannel = undefined;
		}

		if (this.connection) {
			this.connection.close();
		}
	}

	public sendMessage(message: string) {
		if (this.connection.connectionState !== 'connected') {
			const error = new Error(`Connection to peer ${this.peerId} is not connected (state: ${this.connection.connectionState})`);
			console.warn(`[PEERCONNECTION] ${error.message}`);
			throw error;
		}

		if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
			const error = new Error(`Data channel to peer ${this.peerId} is not open (state: ${this.dataChannel?.readyState})`);
			console.warn(`[PEERCONNECTION] ${error.message}`);
			const disconnectedEvent = new CustomEvent('disconnected', { detail: { peerId: this.peerId } });
			this.dispatchEvent(disconnectedEvent);
			throw error;
		}

		try {
			this.dataChannel.send(message);
		} catch (error) {
			console.error('[PEERCONNECTION] Error sending message. Error: ', error);
			throw error;
		}
	}

	private dataChannelErrorHandler(event: RTCErrorEvent) {
		console.log('Error on data channel', event);
	}

	private iceCandidateErrorHandler(event: RTCPeerConnectionIceErrorEvent) {
		console.log('ICE candidate error:', event);
	}

	private dataChannelEventHandler(event: RTCDataChannelEvent) {
		this.dataChannel = event.channel as RTCDataChannel;

		this.dataChannel.addEventListener('message', this.boundDataChannelMessageHandler);
	}

	private dataChannelStateChangeHandler() {
		const state = this.dataChannel?.readyState;
		console.debug(`[PEERCONNECTION] Data channel state changed to ${state} for peer ${this.peerId}`);
		
		if (state === 'open') {
			console.debug(`[PEERCONNECTION] Data channel opened to peer ${this.peerId}`);
		} else if (state === 'closed') {
			console.warn(`[PEERCONNECTION] Data channel closed for peer ${this.peerId}`);
			const disconnectedEvent = new CustomEvent('disconnected', {
				detail: { peerId: this.peerId }
			});
			this.dispatchEvent(disconnectedEvent);
		}
	}

	private dataChannelMessageHandler(event: MessageEvent) {
		const newMessageEvent = new CustomEvent('newMessage', {
			detail: {
				peerId: this.peerId,
				message: event.data
			}
		});

		this.dispatchEvent(newMessageEvent);
	}

	private iceConnectionStateChangeHandler() {
		const iceState = this.connection.iceConnectionState
		console.debug(`[PEERCONNECTION] ICE connection state changed to ${iceState} for peer ${this.peerId}`);		
		if (iceState === 'failed') {
			if (this.iceRestartCount < 3) {
				console.warn(`[PEERCONNECTION] ICE failed. Restarting ICE (attempt ${this.iceRestartCount + 1}/3)`);
				this.iceRestartCount++;
				this.connection.restartIce();
			} else {
				console.error(`[PEERCONNECTION] Max ICE restarts exceeded for peer ${this.peerId}`);
				const disconnectedEvent = new CustomEvent('disconnected', { detail: { peerId: this.peerId } });
				this.dispatchEvent(disconnectedEvent);
			}
		}
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
			console.log('[PEERCONNECTION] CONNECTION ESTABLISHED');
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
			console.log('[PEERCONNECTION] CONNECTION FAILED');
			const connectionFailedEvent: ConnectionFailedEvent = new CustomEvent('connectionFailed', {
				detail: {
					peerId: this.peerId
				}
			});

			this.dispatchEvent(connectionFailedEvent);
		}

		if (connectionState === 'closed' || connectionState === 'disconnected') {
			console.log('[PEERCONNECTION] CONNECTION CLOSED OR DISCONNECTED');
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
