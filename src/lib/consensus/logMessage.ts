import type { Loggable, Serializable } from '$lib/types';

let currentSequenceNumber = 0;

const getNextSequenceNumber = () => {
	return (currentSequenceNumber += 1);
};

export class LogMessage implements Loggable, Serializable {
	fromPeer: string;
	toPeer: string;
	content: string;
	sequenceNumber: number;

	constructor(fromPeer: string, toPeer: string, content: string) {
		this.fromPeer = fromPeer;
		this.toPeer = toPeer;
		this.content = content;
		this.sequenceNumber = getNextSequenceNumber();
	}

	toString(): string {
		return `${this.sequenceNumber}:${this.fromPeer}:${this.content}`;
	}

	toJson(): string {
		return JSON.stringify({
			fromPeer: this.fromPeer,
			toPeer: this.toPeer,
			content: this.content,
			sequenceNumber: this.sequenceNumber
		});
	}
}