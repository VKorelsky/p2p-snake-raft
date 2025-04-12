import { io, Socket } from 'socket.io-client';

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

export class Signaler {
	private socket: Socket<ServerToClientEvents, ClientToServerEvents>;

	public constructor(circleId: string) {
		this.socket = io(this.buildSocketUrl(circleId));
	}

	private buildSocketUrl(circleId: string): string {
		return `ws://127.0.0.1:5000?circleId=${circleId}`;
	}

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

	public onConnect(listener: () => void) {
		this.socket.on('connect', listener);
	}

	public onNewRoomMember(listener: (newPeerId: string) => void) {
		this.socket.on('newRoomMember', listener);
	}

	public onNewOffer(listener: (fromPeerId: string, offer: any) => void) {
		this.socket.on('newOffer', listener);
	}

	public onNewAnswer(listener: (fromPeerId: string, answer: any) => void) {
		this.socket.on('newAnswer', listener);
	}

	public onNewIceCandidate(
		listener: (fromPeerId: string, newIceCandidate: any) => void
	) {
		this.socket.on('newIceCandidate', listener);
	}

	public close() {
		this.socket.close();
	}
}
