import type { PeerPool } from '$lib/rtc/peerPool';
import type { Signaler } from '$lib/rtc/signaler';
import type { Serializable } from '$lib/types';

type LogObserverType = 'LEADER' | 'FOLLOWER' | 'CANDIDATE';
type ClusterMemberId = string;

// This is the replicated log
class ObservedLogEntry<T> implements Serializable {
	entry: T;
	term: number;

	constructor(content: T, term: number) {
		this.entry = content;
		this.term = term;
	}

	toString(): string {
		return `${this.term}:${this.entry}`;
	}

	toJson(): string {
		return JSON.stringify({
			content: this.entry,
			term: this.term
		});
	}
}

// what I as a log observer think the state of the shared log is
interface ObservedState {
	currentTerm: number;
	leaderPeerId: ClusterMemberId;
	log: ObservedLogEntry<string>[]; // TODO type the strings into actual moves
	idxLastCommitted: number;
	idxLastApplied: number;

	// only present if observer is leader
	replicationState?: {
		[serverId: ClusterMemberId]: {
			idxNextEntryToReplicate: number;
			idxLastEntryReplicated: number;
		};
	};
}

// events that will be shared with wider world
interface Event<T> {
	detail: T;
	[key: string]: any;
}

interface NewLogEntryEvent<T> extends Event<{ entry: T }> {}

interface ObserverTypeChangeEvent
	extends Event<{
		oldType: LogObserverType;
		newType: LogObserverType;
	}> {}

// abstraction over a peer pool that is used to broadcast and send messages
//
export class LogObserver {
	private peerPool: PeerPool;
	private signaler: Signaler;
	private type: LogObserverType;
	private votedFor: ClusterMemberId;
	private observedState: ObservedState;

	public constructor(peerPool: PeerPool, signaler: Signaler) {
		this.peerPool = peerPool;
		this.signaler = signaler;

		// initial state
		this.type = 'FOLLOWER';
		this.votedFor = '0';
		this.observedState = {
			currentTerm: 0,
			leaderPeerId: '',
			log: [],
			idxLastApplied: 0,
			idxLastCommitted: 0
		};
	}

	public startObserving(): void {}

	public getObserverType(): LogObserverType {
		return this.type;
	}

	public leave(): void {}
}
