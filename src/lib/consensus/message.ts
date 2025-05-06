import type { Serializable } from '$lib/types';
import type { ObservedLogEntry } from './logObserver';

// TODO move to zod or protobuf probably instead of everything OOP
export class AppendEntryMessage implements Serializable {
	constructor(
		public term: number,
		public leaderId: string,
		public prevLogIndex: number,
		public prevLogTerm: number,
		public newLogEntry: string,
		public leaderCommitIndex: number
	) {
		this.term = term;
		this.leaderId = leaderId;
		this.prevLogIndex = prevLogIndex;
		this.prevLogTerm = prevLogTerm;
		this.newLogEntry = newLogEntry;
		this.leaderCommitIndex = leaderCommitIndex;
	}

	toJson(): string {
		return JSON.stringify({
			type: 'AppendEntryRequest',
			term: this.term,
			leaderId: this.leaderId,
			prevLogIndex: this.prevLogIndex,
			prevLogTerm: this.prevLogTerm,
			newLogEntries: this.newLogEntry,
			leaderCommitIndex: this.leaderCommitIndex
		});
	}
}

export class AppendEntryResponse implements Serializable {
	constructor(
		public term: number,
		public success: boolean
	) {
		this.term = term;
		this.success = success;
	}

	toJson(): string {
		return JSON.stringify({
			type: 'AppendEntryResponse',
			term: this.term,
			success: this.success
		});
	}
}

// message used to request a vote
export class RequestElectionMessage implements Serializable {
	constructor(
		public term: number,
		public candidateId: string,
		public lastLogEntryMetadata: { index: number; term: number }
	) {
		this.term = term;
		this.candidateId = candidateId;
		this.lastLogEntryMetadata = lastLogEntryMetadata;
	}

	toJson(): string {
		return JSON.stringify({ type: 'RequestElectionMessage' });
	}
}

export class RequestElectionResponse implements Serializable {
	constructor(
		public term: number,
		public voteGranted: boolean
	) {
		this.term = term;
		this.voteGranted = voteGranted;
	}

	toJson(): string {
		return JSON.stringify({
			type: 'AppendEntryResponse',
			term: this.term,
			voteGranted: this.voteGranted
		});
	}
}

// TBD
// a new node joining a cluster will ask its leader for a snapshot
export class RequestSnapshotMessage implements Serializable {
	// TBD, not part of the original spec
	toJson(): string {
		return JSON.stringify({ type: 'RequestSnapshotMessage' });
	}
}

// A client message asking the leader to write a message to the log //
export class RequestAppendMessage implements Serializable {
	constructor(public msg: string) {
		this.msg = msg;
	}

	toJson(): string {
		return JSON.stringify({
			type: 'WriteMessage',
			msg: this.msg
		});
	}
}
