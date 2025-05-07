import { io, Socket } from 'socket.io-client';

export type SignalerEvent = newOfferEvent | newAnswerEvent | newIceCandidateEvent;
export type SignalerEventListener = (event: SignalerEvent) => Promise<void>;

export interface newOfferEvent {
	fromPeerId: string;
	offer: any;
}

export interface newAnswerEvent {
	fromPeerId: string;
	answer: any;
}

export interface newIceCandidateEvent {
	fromPeerId: string;
	newIceCandidate: any;
}

export interface ClientToServerEvents {
	joinCircle: (circleId: string) => void;
	leaveCircle: (circleId: string) => void;
	sendOffer: (toPeerId: string, offer: any) => void;
	sendAnswer: (toPeerId: string, offer: any) => void;
	sendIceCandidate: (toPeerId: string, iceCandidate: any) => void;
}

export interface ServerToClientEvents {
	newRoomMember: (newPeerId: string) => void;
	newOffer: (event: newOfferEvent) => void;
	newAnswer: (event: newAnswerEvent) => void;
	newIceCandidate: (event: newIceCandidateEvent) => void;
}

export class Signaler extends EventTarget {
	private circleId: string;
	private socket?: Socket<ServerToClientEvents, ClientToServerEvents>;

	public constructor(circleId: string) {
		super();
		this.circleId = circleId;
	}

	public connect() {
		this.socket = io(this.buildSocketUrl(this.circleId), {
			reconnectionAttempts: 2,
			// restrict to websockets as when the server restarts, socket io switches to long polling
			// which triggers CORS blocking by the browser for some reason
			transports: ['websocket']
		});
	}

	private buildSocketUrl(circleId: string): string {
		return `ws://127.0.0.1:5000?circleId=${circleId}`;
	}

	// ====== CLIENT TO SERVER HANDLERS ====== //
	public leaveCircle(circleId: string) {
		this.getSocket().emit('leaveCircle', circleId);
	}

	public sendOffer(toPeerId: string, offer: any) {
		this.getSocket().emit('sendOffer', toPeerId, offer);
	}

	public sendAnswer(toPeerId: string, answer: any) {
		this.getSocket().emit('sendAnswer', toPeerId, answer);
	}

	public sendIceCandidate(toPeerId: string, iceCandidate: any) {
		this.getSocket().emit('sendIceCandidate', toPeerId, iceCandidate);
	}

	// ====== SOCKET ADMIN ======
	public onConnect(listener: (sessionIdentifier: string) => void) {
		this.getSocket().on('connect', () => {
			const sessionIdentifier = this.getSocket().id!; // socket is connected so we have an id available
			listener(sessionIdentifier);
		});
	}

	public onConnectError(listener: (error: Error) => void) {
		this.getSocket().on('connect_error', listener);
	}

	public onDisconnect(listener: (reason: string) => void) {
		this.getSocket().on('disconnect', listener);
	}

	// ====== SERVER TO CLIENT HANDLERS ======
	// Type challenge
	// a generic on function that accepts the event name as the first parameter and it's corresponding payload
	// as the second parameter
	public onNewRoomMember(listener: (newPeerId: string) => void) {
		// TODO change this to new circle member instead of new room member
		this.getSocket().on('newRoomMember', listener);
	}

	public onNewOffer(listener: (event: newOfferEvent) => void) {
		this.getSocket().on('newOffer', listener);
	}

	public onNewAnswer(listener: (event: newAnswerEvent) => void) {
		this.getSocket().on('newAnswer', listener);
	}

	public onNewIceCandidate(listener: (event: newIceCandidateEvent) => void) {
		this.getSocket().on('newIceCandidate', listener);
	}

	public close() {
		this.getSocket().close();
	}

	private getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
		if (!this.socket) {
			throw new Error('Signaler is not initialized');
		}

		return this.socket;
	}
}
