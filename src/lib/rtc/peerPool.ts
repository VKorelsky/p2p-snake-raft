import { TypedEventTarget, type Serializable } from '$lib/types';
import { PeerConnection, type NewMessageEvent, type ConnectionEstablishedEvent, type ConnectionFailedEvent, type ConnectionDisconnectedEvent, type IceCandidateSentEvent, type IceCandidateReceivedEvent } from './peerConnection';
import type { NewOfferEvent, Signaler } from './signaler';


interface PeerPoolEventMap {
	"newMessage": NewMessageEvent;
	"peerConnected": CustomEvent<{ peerId: string; }>;
	"peerDisconnected": CustomEvent<{ peerId: string; }>;
}

export type PeerPoolPeerConnectedEvent = PeerPoolEventMap["peerConnected"]
export type PeerPoolPeerDisconnectedEvent = PeerPoolEventMap["peerDisconnected"]

interface PeerMap {
	[peerId: string]: PeerConnection;
}

export class PeerPool extends TypedEventTarget<PeerPoolEventMap> {
	private ownPeerId: string;
	private signaler: Signaler;
	private peers: PeerMap;

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

	public sendMessage(toPeerId: string, message: Serializable) {
		if (!(toPeerId in this.peers)) {
			throw new Error(`No peer found matching the id ${toPeerId}`);
		}

		const con = this.peers[toPeerId];

		if (!con.isOpen) {
			throw new Error(`Connection to peer with id ${toPeerId} is not open`);
		}

		con.sendMessage(message.toJson());
	}

	public close() {
		Object.values(this.peers).forEach((con) => {
			console.log('closing connection with peer', con);
			con.close();
		});
		// TODO: Improve teardown
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
		const connection = new PeerConnection(this.ownPeerId, otherPeerId, this.signaler);

		connection.addEventListener('connectionEstablished', (event: ConnectionEstablishedEvent) => {
			console.log(`Connected to peer ${event.detail.peerId}`);
			const connection = event.target as PeerConnection;
			this.peers[event.detail.peerId] = connection;

			const newPeerConnectedEvent = new CustomEvent('peerConnected', {
				detail: { peerId: event.detail.peerId }
			});

			this.dispatchEvent(newPeerConnectedEvent);
		});

		connection.addEventListener('connectionFailed', (event: ConnectionFailedEvent) => {
			console.log(`Connection failed with peer ${event.detail.peerId}`);
		});

		connection.addEventListener('disconnected', (event: ConnectionDisconnectedEvent) => {
			console.log(`Disconnected from peer ${event.detail.peerId}`);
			delete this.peers[event.detail.peerId];

			const peerDisconnectedEvent = new CustomEvent('peerDisconnected', {
				detail: { peerId: event.detail.peerId }
			});

			this.dispatchEvent(peerDisconnectedEvent);
		});

		connection.addEventListener('newMessage', (event: NewMessageEvent) => {
			const data = event.detail;

			const newMessageEvent = new CustomEvent('newMessage', {
				detail: {
					peerId: data.peerId,
					message: data.message
				}
			});

			this.dispatchEvent(newMessageEvent);
		});

		connection.addEventListener('iceCandidateSent', (event: IceCandidateSentEvent) => {
			console.log(`ICE candidate sent to peer ${event.detail.peerId}`);
		});

		connection.addEventListener('iceCandidateReceived', (event: IceCandidateReceivedEvent) => {
			console.log(`ICE candidate received from peer ${event.detail.peerId}`);
		});

		return connection;
	}
}
