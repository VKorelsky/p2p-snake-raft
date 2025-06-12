import type { Serializable } from '$lib/types';
import type { ObservedLogEntry } from './logObserver';

export type Message = AppendEntryMessage | AppendEntryResponse | RequestElectionMessage | RequestElectionResponse | InstallSnapshotMessage | InstallSnapshotResponse | RequestAppendMessage | string

export class AppendEntryMessage implements Serializable {
	constructor(
		public term: number,
		public leaderId: string,
		public prevLogIndex: number,
		public prevLogTerm: number,
		public newLogEntry: string | null,
		public leaderLastReplicatedIndex: number
	) {
		this.term = term;
		this.leaderId = leaderId;
		this.prevLogIndex = prevLogIndex;
		this.prevLogTerm = prevLogTerm;
		this.newLogEntry = newLogEntry;
		this.leaderLastReplicatedIndex = leaderLastReplicatedIndex;
	}

	toJson(): string {
		return JSON.stringify({
			type: 'AppendEntryRequest',
			term: this.term,
			leaderId: this.leaderId,
			prevLogIndex: this.prevLogIndex,
			prevLogTerm: this.prevLogTerm,
			newLogEntry: this.newLogEntry,
			leaderCommitIndex: this.leaderLastReplicatedIndex
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
		public idxLastLogEntry: number,
		public termLastLogEntry: number
	) {
		this.term = term;
		this.candidateId = candidateId;
		this.idxLastLogEntry = idxLastLogEntry;
		this.termLastLogEntry = termLastLogEntry;
	}

	toJson(): string {
		return JSON.stringify({
			type: 'RequestElectionMessage',
			term: this.term,
			candidateId: this.candidateId,
			prevLogIndex: this.idxLastLogEntry,
			prevLogTerm: this.termLastLogEntry
		});
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
			type: 'RequestElectionResponse',
			term: this.term,
			voteGranted: this.voteGranted
		});
	}
}

export class InstallSnapshotMessage implements Serializable {
	constructor(
		public term: number,
		public leaderId: string,
		public lastIncludedIndex: number,
		public lastIncludedTerm: number,
		public state: (ObservedLogEntry<string> | null)[],
	) {
		this.term = term;
		this.leaderId = leaderId;
		this.lastIncludedIndex = lastIncludedIndex;
		this.lastIncludedTerm = lastIncludedTerm;
		this.state = state;
	}

	toJson(): string {
		return JSON.stringify({
			type: 'InstallSnapshotRequest',
			term: this.term,
			leaderId: this.leaderId,
			lastIncludedIndex: this.lastIncludedIndex,
			lastIncludedTerm: this.lastIncludedTerm,
			state: this.state,
		});
	}
}

export class InstallSnapshotResponse implements Serializable {
	constructor(
		public term: number,
		public lastIncludedIndex: number,
		public lastInstallTimestamp: number,
		public success: boolean,
	){
		this.term = term;
		this.lastIncludedIndex = lastIncludedIndex;
		this.lastInstallTimestamp = lastInstallTimestamp;
		this.success = success;
	}

	toJson(): string {
		return JSON.stringify({
			type: 'InstallSnapshotResponse',
			term: this.term,
			lastIncludedIndex: this.lastIncludedIndex,
			lastInstallTimestamp: this.lastInstallTimestamp,
			success: this.success
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
			type: 'RequestAppendMessage',
			msg: this.msg
		});
	}
}
