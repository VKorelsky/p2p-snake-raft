import { PeerPool } from '$lib/rtc/peerPool';
import { Signaler } from '$lib/rtc/signaler';
import type { Serializable } from '$lib/types';
import { getRandomNumber, getRandomNumberInRange } from '$lib/utils';
import {
	AppendEntryResponse,
	RequestElectionResponse,
	type AppendEntryMessage,
	type RequestElectionMessage
} from './message';

type LogObserverType = 'LEADER' | 'FOLLOWER' | 'CANDIDATE';
type ClusterMemberId = string;

// This is the replicated log
export class ObservedLogEntry<T> implements Serializable {
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
	leaderId: ClusterMemberId;
	log: (ObservedLogEntry<string> | null)[]; // TODO type the strings into actual moves
	idxLastCommitted: number;
	idxLastApplied: number;
	peerCount: number; // invariant -> on a leader, this is up to date. Anyways we will start with

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

// newLogEntry
interface NewLogEntryEvent<T> extends Event<{ entry: T }> {}

// observerTypeChanged
interface ObserverTypeChangeEvent
	extends Event<{
		oldType: LogObserverType;
		newType: LogObserverType;
	}> {}

// peerConnected
interface NewPeerConnected extends Event<{}> {}

// peerDisconnected
interface PeerDisconnected extends Event<{}> {}

// OK so how does this work.
// I join. I'm initially a follower
// I wait for a leader to show up
// If there is no leader, I send out an election RPC (if no response, i try again after electionTimeout)
// if there is a response, then I become leader or not

// append message
// if I am leader, I send append RPC to everyone else.
// if I am not, I send the request to the leader, who will then broadcast it
// the leader must keep track of how many responses it got for a specific index and term. If it got more than half of the observed peer count responses
// then it commits to the log and schedules a new entry event
// otherwise just increment the observed count

// abstraction over a peer pool that is used to broadcast and send messages
// TODO peerPool and Signaler should have some methods to create them before connecting
export class LogObserver extends EventTarget {
	private peerPool?: PeerPool;
	private signaler?: Signaler;
	private type: LogObserverType;
	private ownId?: ClusterMemberId;
	private votedFor?: ClusterMemberId;
	private observedState: ObservedState;
	private electionTimeoutMs: number;
	private electionInterval?: number;

	public constructor() {
		super();
		// initial state
		this.type = 'FOLLOWER';
		this.observedState = {
			currentTerm: 0,
			leaderId: '',
			peerCount: 0,
			log: new Array(100).fill(null),
			idxLastApplied: 0,
			idxLastCommitted: 0
		};
		this.electionTimeoutMs = getRandomNumberInRange(3000, 5000);

		this.resetElectionInterval();
	}

	public startObserving(): void {
		// TODO should not store circle ID here
		this.signaler = new Signaler('697d8c94-cee3-4a99-a3b6-b7cced7927fc');

		this.signaler.onConnect((sessionIdentifier) => {
			this.initPeerPool(sessionIdentifier);
		});

		this.signaler.onConnectError((err) => {
			console.error(err);
		});

		this.signaler.onDisconnect((reason) => {
			console.log(`Disconnected from socket. Reason provided is ${reason}`);
		});
	}

	public append(newEntry: string) {
		if (!this.peerPool) {
			throw new Error('Cannot share log entry: PeerPool is not initialized.');
		}

		this.peerPool.broadcast(newEntry);
	}

	public getPeerCount(): number {
		return this.peerPool!.getConnectedPeerCount();
	}

	public getObserverType(): LogObserverType {
		return this.type;
	}

	public leave(): void {
		console.log('disconnecting from the signaler...');

		if (!this.signaler) {
			console.log('Not connected, nothing to disconnect from');
			return;
		}

		this.signaler.close();

		if (this.peerPool) {
			this.peerPool.close();
		}
	}

	private initPeerPool(ownId: ClusterMemberId) {
		this.ownId = ownId;
		// TODO probably a way to not have to put `!` to tell TS that we have a signaler
		this.peerPool = new PeerPool(ownId, this.signaler!);

		this.peerPool.addEventListener('peerConnected', (event: any) => {
			console.log(`Peer ${event.detail.peerId} connected`);
			this.observedState.peerCount += 1;

			const dispatch = new CustomEvent('peerConnected', {
				detail: {}
			});

			this.dispatchEvent(dispatch);
		});

		this.peerPool.addEventListener('peerDisconnected', (event: any) => {
			console.log(`Peer ${event.detail.peerId} disconnected`);
			this.observedState.peerCount -= 1;

			const dispatch = new CustomEvent('peerDisconnected', { detail: {} });
			this.dispatchEvent(dispatch);
		});

		this.peerPool.addEventListener('newMessage', (event: any) => {
			console.log('New message event received:', event.detail);
			this.processIncomingMessage(event.detail.peerId, event.detail.message);
		});
	}

	// Deserialize and route message
	private processIncomingMessage(fromPeerId: string, message: string) {}

	// ================= APPEND ENTRY ==================
	private appendEntry(entry: string) {}

	private handleAppendEntryMessage(fromPeerId: string, message: AppendEntryMessage) {
		if (message.term < this.observedState.currentTerm) {
			this.peerPool!.sendMessage(
				fromPeerId,
				new AppendEntryResponse(this.observedState.currentTerm, false)
			);
			return;
		}

		if (
			this.observedState.log[message.prevLogMetadata.index]?.term !== message.prevLogMetadata.term
		) {
			this.peerPool!.sendMessage(
				fromPeerId,
				new AppendEntryResponse(this.observedState.currentTerm, false)
			);
			return;
		}

		const newEntry = message.newLogEntry;

		if ((newEntry.entry = '')) {
			// heartbeat message
			this.resetElectionInterval();
			return;
		}

		this.applyLogEntry(
			message.prevLogMetadata.index + 1,
			message.newLogEntry.entry,
			message.leaderCommitIndex
		);

		this.peerPool!.sendMessage(
			fromPeerId,
			new AppendEntryResponse(this.observedState.currentTerm, true)
		);
	}

	private handleAppendEntryResponse(fromPeerId: string, message: AppendEntryResponse) {}

	// ================= REQUEST ELECTION ==================
	private requestElection() {}

	private handleRequestElectionMessage(fromPeerId: string, message: RequestElectionMessage) {
		const termIsGreaterThanOrEqual = message.term < this.observedState.currentTerm;

		const isLogUpToDate =
			message.lastLogEntryMetadata.term === this.observedState.currentTerm &&
			message.lastLogEntryMetadata.index === this.observedState.idxLastApplied;

		const voteGranted = this.votedFor === undefined && termIsGreaterThanOrEqual && isLogUpToDate;

		this.peerPool!.sendMessage(
			fromPeerId,
			new RequestElectionResponse(this.observedState.currentTerm, voteGranted)
		);

		this.votedFor = fromPeerId;
	}

	private handleRequestElectionResponse(fromPeerId: string, message: RequestElectionResponse) {}

	private applyLogEntry(index: number, entry: string, leaderCommitIndex: number) {
		const newLogEntry = new ObservedLogEntry(entry, this.observedState.currentTerm);

		if (this.observedState.log[index] !== null) {
			// an entry is already present on my node
			// overwrite it and delete all entries that follow
			this.observedState.log[index] = newLogEntry;
			const ptr = index + 1;

			while (this.observedState.log[ptr] != null) {
				this.observedState.log[ptr] = null;
			}
		} else {
			// just add it
			this.observedState.log[index] = newLogEntry;
		}

		this.observedState.idxLastCommitted = index;
		// TODO -> understand why?
		this.observedState.idxLastCommitted = Math.min(leaderCommitIndex, index);

		// TODO probably need an event to say that I removed a log entry if I update my local state
		const dispatch = new CustomEvent('newLogEntry', {
			detail: {
				entry: entry
			}
		});

		this.dispatchEvent(dispatch);
	}

	private resetElectionInterval() {
		if (this.electionInterval) {
			clearInterval(this.electionInterval);
		}

		this.electionInterval = setInterval(() => {
			console.log('No heartbeat detected, triggering election');
			// Convert to candidate
			this.type = 'CANDIDATE';
			this.observedState.replicationState = undefined; // clear if it was set
			
			// request election
			this.requestElection();
		}, this.electionTimeoutMs);
	}
}
