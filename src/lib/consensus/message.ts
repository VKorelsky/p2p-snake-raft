import type { Serializable } from '$lib/types';
import type { ObservedLogEntry } from './log';

// TODO move to zod or protobuf probably instead of everything OOP
export class AppendEntryMessage implements Serializable {
    constructor(
        public term: number,
        public leaderId: string,
        public prevLogMetadata: { index: number; term: number },
        public newLogEntries: ObservedLogEntry<any>[],
        public leaderCommitIndex: number
    ) {
        this.term = term;
        this.leaderId = leaderId;
        this.prevLogMetadata = prevLogMetadata;
        this.newLogEntries = newLogEntries;
        this.leaderCommitIndex = leaderCommitIndex;
    }

    toJson(): string {
        return JSON.stringify({
            type: 'AppendEntryRequest',
            term: this.term,
            leaderId: this.leaderId,
            prevLogMetadata: this.prevLogMetadata,
            newLogEntries: this.newLogEntries,
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
export class RequestElectionMessage<T> implements Serializable {
	constructor(
		public term: number,
		public candidateId: string,
		public lastLogEntry: ObservedLogEntry<T>
	) {
		this.term = term;
		this.candidateId = candidateId;
		this.lastLogEntry = lastLogEntry;
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
