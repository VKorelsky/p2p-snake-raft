import { TypedEventTarget, type Serializable } from '$lib/types';
import { PeerConnection, type NewMessageEvent, type ConnectionEstablishedEvent, type ConnectionFailedEvent, type ConnectionDisconnectedEvent, type IceCandidateSentEvent, type IceCandidateReceivedEvent } from './peerConnection';
import type { NewOfferEvent, Signaler } from './signaler';


interface PeerPoolEventMap {
	newMessage: NewMessageEvent;
	peerConnected: CustomEvent<{ peerId: string; }>;
	peerDisconnected: CustomEvent<{ peerId: string; }>;
}

export type PeerPoolPeerConnectedEvent = PeerPoolEventMap["peerConnected"]
export type PeerPoolPeerDisconnectedEvent = PeerPoolEventMap["peerDisconnected"]

type ConnectionEstablishedEventListener = (event: ConnectionEstablishedEvent) => void;
type ConnectionFailedEventListener = (event: ConnectionFailedEvent) => void;
type ConnectionDisconnectedEventListener = (event: ConnectionDisconnectedEvent) => void;
export type NewMessageEventListener = (event: NewMessageEvent) => void;
type IceCandidateSentEventListener = (event: IceCandidateSentEvent) => void;
type IceCandidateReceivedEventListener = (event: IceCandidateReceivedEvent) => void;

interface PeerMap {
	[peerId: string]: PeerConnection;
}

export class PeerPool extends TypedEventTarget<PeerPoolEventMap> {
	private ownPeerId: string;
	private signaler: Signaler;
	private peers: PeerMap;
	private listenerRegistry: Record<string,{
    connection: PeerConnection,
    handlers: {
      onConnectionEstablished: ConnectionEstablishedEventListener,
      onConnectionFailed: ConnectionFailedEventListener,
      onConnectionDisconnected: ConnectionDisconnectedEventListener,
      onNewMessage: NewMessageEventListener,
      onIceCandidateSent: IceCandidateSentEventListener,
      onIceCandidateReceived: IceCandidateReceivedEventListener
    }
  }> = {};

	public constructor(signaler: Signaler) {
		super();
		this.ownPeerId = '';
		this.signaler = signaler;
		this.peers = {};

		this.signaler.onReady(() => {
			this.signaler.onConnect((id) => (this.ownPeerId = id));
			this.signaler.onNewRoomMember(this.getNewRoomMemberHandler());
			this.signaler.onNewOffer(this.getNewOfferHandler());
		});
	}

	public getConnectedPeerCount(): number {
		return Object.keys(this.peers).length;
	}

	public getOpenPeers(): PeerMap {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		return Object.fromEntries(Object.entries(this.peers).filter(([_, peer]) => peer.isOpen()));
	}

	public broadcast(message: Serializable) {
		Object.values(this.peers).forEach((con) => con.isOpen() && con.sendMessage(message.toJson()));
	}

	public sendMessage(toPeerId: string, message: Serializable, retries = 3) {
		if (!this.peers[toPeerId]) {
			throw new Error(`No peer found matching the id ${toPeerId}`);
		}

		const con = this.peers[toPeerId];

		if (!con.isOpen) {
			console.error(`[PEERPOOL] Connection to peer ${toPeerId} is not open`);
			delete this.peers[toPeerId];
			delete this.listenerRegistry[toPeerId];
			const peerDisconnectedEvent: PeerPoolPeerDisconnectedEvent = new CustomEvent('peerDisconnected', { detail: { peerId: toPeerId } });
			this.dispatchEvent(peerDisconnectedEvent);
			throw new Error(`Connection to peer with id ${toPeerId} is not open`);
		}

		try {		
			con.sendMessage(message.toJson());
		} catch (error) {
			if (retries > 0) {
				console.warn(`[PEERPOOL] Retrying message to peer ${toPeerId} (${retries} retries left)`);
				setTimeout(() => this.sendMessage(toPeerId, message, retries - 1), 500);
			} else {
				console.error(`[PEERPOOL] Failed to send message to peer ${toPeerId} after retries:`, error);
				delete this.peers[toPeerId];
				delete this.listenerRegistry[toPeerId];
				const peerDisconnectedEvent = new CustomEvent('peerDisconnected', { detail: { peerId: toPeerId } });
				this.dispatchEvent(peerDisconnectedEvent);
				throw error;
			}
		}
	}

	public close() {
		for (const [peerId, { connection, handlers }] of Object.entries(this.listenerRegistry)) {
			console.log(`${this.ownPeerId} DISCONNECTING FROM PEER ID ${peerId}`);
			connection.removeEventListener('connectionEstablished', handlers.onConnectionEstablished);
			connection.removeEventListener('connectionFailed', handlers.onConnectionFailed);
			connection.removeEventListener('disconnected', handlers.onConnectionDisconnected);
			connection.removeEventListener('newMessage', handlers.onNewMessage);
			connection.removeEventListener('iceCandidateSent', handlers.onIceCandidateSent);
			connection.removeEventListener('iceCandidateReceived', handlers.onIceCandidateReceived);

      connection.close();
    }

    this.listenerRegistry = {};
		this.peers = {};
	}

	private getNewRoomMemberHandler() {
		return async (newPeerId: string) => {
			const connection = this.createNewConnection(newPeerId);
			this.peers[newPeerId] = connection;
			await connection.initiate();
		};
	}

	private getNewOfferHandler() {
		return async (event: NewOfferEvent) => {
			const offer = new RTCSessionDescription(event.offer);
			const connection = this.createNewConnection(event.fromPeerId);
			this.peers[event.fromPeerId] = connection;
			await connection.initiateFrom(offer);
		};
	}

	private createNewConnection(otherPeerId: string) {
		if (this.peers[otherPeerId]) {
			console.warn(`[PEERPOOL] Peer ${otherPeerId} already exists in PeerPool`);
			return this.peers[otherPeerId];
		}

		const connection = new PeerConnection(this.ownPeerId, otherPeerId, this.signaler);
		
		const onConnectionEstablished = (event: ConnectionEstablishedEvent) => {
			console.log(`[PEERPOOL] Connected to peer ${event.detail.peerId}`);
			const connection = event.target as PeerConnection;
			this.peers[event.detail.peerId] = connection;

			const newPeerConnectedEvent = new CustomEvent('peerConnected', {
				detail: { peerId: event.detail.peerId }
			});

			this.dispatchEvent(newPeerConnectedEvent);
		}

		const onConnectionFailed = (event: ConnectionFailedEvent) => {
			console.error(`[PEERPOOL] Connection failed with peer ${event.detail.peerId}`);
		}

		const onConnectionDisconnected = (event: ConnectionDisconnectedEvent) => {
			console.log(`[PEERPOOL] Disconnected from peer ${event.detail.peerId}`);
			const peerId = event.detail.peerId
			delete this.peers[peerId];

			if (this.listenerRegistry[peerId]) {
				const { connection, handlers } = this.listenerRegistry[peerId];
				connection.removeEventListener('connectionEstablished', handlers.onConnectionEstablished);
				connection.removeEventListener('connectionFailed', handlers.onConnectionFailed);
				connection.removeEventListener('disconnected', handlers.onConnectionDisconnected);
				connection.removeEventListener('newMessage', handlers.onNewMessage);
				connection.removeEventListener('iceCandidateSent', handlers.onIceCandidateSent);
				connection.removeEventListener('iceCandidateReceived', handlers.onIceCandidateReceived);
				delete this.listenerRegistry[peerId];
			}

			const peerDisconnectedEvent = new CustomEvent('peerDisconnected', {
				detail: { peerId: event.detail.peerId }
			});

			this.dispatchEvent(peerDisconnectedEvent);
		}

		const onNewMessage = (event: NewMessageEvent) => {
			const data = event.detail;

			const newMessageEvent = new CustomEvent('newMessage', {
				detail: {
					peerId: data.peerId,
					message: data.message
				}
			});

			this.dispatchEvent(newMessageEvent);
		}

		const onIceCandidateSent = (event: IceCandidateSentEvent) => {
			console.log(`ICE candidate sent to peer ${event.detail.peerId}`);
		}

		const onIceCandidateReceived = (event: IceCandidateReceivedEvent) => {
			console.log(`ICE candidate received from peer ${event.detail.peerId}`);
		}

		connection.addEventListener('connectionEstablished', onConnectionEstablished);
		connection.addEventListener('connectionFailed', onConnectionFailed);
		connection.addEventListener('disconnected', onConnectionDisconnected);
		connection.addEventListener('newMessage', onNewMessage);
		connection.addEventListener('iceCandidateSent', onIceCandidateSent);
		connection.addEventListener('iceCandidateReceived', onIceCandidateReceived);

		this.listenerRegistry[otherPeerId] = {
      connection,
      handlers: { onConnectionEstablished, onConnectionFailed, onConnectionDisconnected, onNewMessage, onIceCandidateSent, onIceCandidateReceived }
    };

		return connection;
	}
}
