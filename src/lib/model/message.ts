let currentSequenceNumber = 0;

const getNextSequenceNumber = () => {
	return (currentSequenceNumber += 1);
};

export interface IMessage {
	toString: () => string;
}

export class Message implements IMessage {
	// a message which is part of the shared log
	// no to peer because all messages are broadcast to everyone
	fromPeer: string;
	content: string;
	sequenceNumber: number;

	constructor(fromPeer: string, content: string) {
		this.fromPeer = fromPeer;
		this.content = content;
		this.sequenceNumber = getNextSequenceNumber();
	}

	toString(): string {
		return `[${this.sequenceNumber}] - [${this.fromPeer}] ${this.content}`;
	}
}

export class SystemMessage implements IMessage {
	// a message which is not part of the shared log
	content: string;

	constructor(content: string) {
		this.content = content;
	}

	toString(): string {
		return `[SYSTEM] ${this.content}`;
	}
}
