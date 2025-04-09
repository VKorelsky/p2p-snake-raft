import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

interface ClientToServerEvents {
	joinCircle: (peerId: string, circleId: string) => void;
	leaveCircle: (peerId: string, circleId: string) => void;
	sendOffer: (fromPeerId: string, toPeerId: string, offer: any) => void;
	sendAnswer: (fromPeerId: string, toPeerId: string, offer: any) => void;
	// for now we assume that we can broadcast our ICE candidate to everyone equally
	broadcastIceCandidate: (fromPeerId: string, iceCandidate: any) => void;
}

interface ServerToClientEvents {
	newOffer: (fromPeerId: string, toPeerId: string, offer: any) => void;
	newAnswer: (fromPeerId: string, toPeerId: string, answer: any) => void;
	newIceCandidate: (fromPeerId: string, toPeerId: string, iceCandidate: any) => void;
}

export class Signaler {
	private socket: Socket<ServerToClientEvents, ClientToServerEvents>;
	private ownPeerId: string;
	private circleId: string;

	public constructor() {
		this.socket = io('ws://127.0.0.1:5000');
		this.ownPeerId = uuidv4();
		this.circleId = '6902b76a-cff3-4421-b08b-a6c21e6dec99';

		this.socket.on('connect', () => {
			console.log(
				`HELLO I AM CONNECTED, I will now attempt to join ${this.circleId} with my assigned peer id of ${this.ownPeerId}`
			);
			this.joinCircle(this.circleId);
		});
	}

	// next step is to emit events

	public joinCircle(circleId: string) {
		console.log('hey trying to join a circle here')
		this.socket.emit('joinCircle', this.ownPeerId, circleId);
	}

	public leaveCircle(circleId: string) {
		this.socket.emit('leaveCircle', this.ownPeerId, circleId);
	}

	public sendOffer(toPeerId: string, offer: any) {
		this.socket.emit('sendOffer', this.ownPeerId, toPeerId, offer);
	}

	public sendAnswer(toPeerId: string, answer: any) {
		this.socket.emit('sendAnswer', this.ownPeerId, toPeerId, answer);
	}

	public broadcastIceCandidate(iceCandidate: any) {
		this.socket.emit('broadcastIceCandidate', this.ownPeerId, iceCandidate);
	}

	public close() {
		this.socket.close();
	}
}
