import { PeerPool } from '$lib/rtc/peerPool';
import { Signaler } from '$lib/rtc/signaler';
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
	leaderId: ClusterMemberId;
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

// abstraction over a peer pool that is used to broadcast and send messages
// TODO peerPool and Signaler should have some methods to create them before connecting
export class LogObserver extends EventTarget {
	private peerPool?: PeerPool;
	private signaler?: Signaler;
	private type: LogObserverType;
	private ownId?: ClusterMemberId;
	private votedFor: ClusterMemberId;
	private observedState: ObservedState;

	public constructor() {
		super();
		// initial state
		this.type = 'FOLLOWER';
		this.votedFor = '0';
		this.observedState = {
			currentTerm: 0,
			leaderId: '',
			log: [],
			idxLastApplied: 0,
			idxLastCommitted: 0
		};
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

			const dispatch = new CustomEvent('peerConnected', {
				detail: {}
			});

			this.dispatchEvent(dispatch);
		});

		this.peerPool.addEventListener('peerDisconnected', (event: any) => {
			console.log(`Peer ${event.detail.peerId} disconnected`);

			const dispatch = new CustomEvent('peerDisconnected', { detail: {} });
			this.dispatchEvent(dispatch);
		});

		this.peerPool.addEventListener('newMessage', (event: any) => {
			console.log('New message event received:', event.detail);

			// a lot of magic to build here to parse the various possible RPCs, but for now just passing the event through
			const dispatch = new CustomEvent('newLogEntry', {
				detail: {
					entry: event.detail.message
				}
			});
			this.dispatchEvent(dispatch);
		});
	}
}
