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

// TODO -> actually implement this
export class Signaler extends EventTarget {
	private socket: Socket<ServerToClientEvents, ClientToServerEvents>;

	public constructor(circleId: string) {
		super();
		this.socket = io(this.buildSocketUrl(circleId), {
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
		this.socket.emit('leaveCircle', circleId);
	}

	public sendOffer(toPeerId: string, offer: any) {
		this.socket.emit('sendOffer', toPeerId, offer);
	}

	public sendAnswer(toPeerId: string, answer: any) {
		this.socket.emit('sendAnswer', toPeerId, answer);
	}

	public sendIceCandidate(toPeerId: string, iceCandidate: any) {
		this.socket.emit('sendIceCandidate', toPeerId, iceCandidate);
	}

	// ====== SOCKET ADMIN ======
	public onConnect(listener: (sessionIdentifier: string) => void) {
		this.socket.on('connect', () => {
			const sessionIdentifier = this.socket!.id!;
			listener(sessionIdentifier);
		});
	}

	public onConnectError(listener: (error: Error) => void) {
		this.socket.on('connect_error', listener);
	}

	public onDisconnect(listener: (reason: string) => void) {
		this.socket.on('disconnect', listener);
	}

	// ====== SERVER TO CLIENT HANDLERS ======
	// Type challenge
	// a generic on function that accepts the event name as the first parameter and it's corresponding payload
	// as the second parameter
	public onNewRoomMember(listener: (newPeerId: string) => void) {
		// TODO change this to new circle member instead of new room member
		this.socket.on('newRoomMember', listener);
	}

	public onNewOffer(listener: (event: newOfferEvent) => void) {
		this.socket.on('newOffer', listener);
	}

	public onNewAnswer(listener: (event: newAnswerEvent) => void) {
		this.socket.on('newAnswer', listener);
	}

	public onNewIceCandidate(listener: (event: newIceCandidateEvent) => void) {
		this.socket.on('newIceCandidate', listener);
	}

	public close() {
		this.socket.close();
	}
}
