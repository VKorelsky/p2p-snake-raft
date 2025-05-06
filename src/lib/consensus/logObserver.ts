import { PeerPool } from '$lib/rtc/peerPool';
import { Signaler } from '$lib/rtc/signaler';
import type { Serializable } from '$lib/types';
import { getRandomNumberInRange } from '$lib/utils';
import { parse } from 'svelte/compiler';
import {
	AppendEntryMessage,
	AppendEntryResponse,
	RequestElectionMessage,
	RequestElectionResponse,
	RequestAppendMessage
} from './message';

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

type LogObserverType = 'LEADER' | 'FOLLOWER' | 'CANDIDATE';
type ClusterMemberId = string;

// This is the replicated log
// make it a  linked list
export class ObservedLogEntry<T> implements Serializable {
	entry: T;
	term: number;
	acks: number;
	committed: boolean;

	constructor(content: T, term: number) {
		this.entry = content;
		this.term = term;
		this.acks = 0;
		this.committed = false;
	}

	public registerAck() {
		this.acks += 1;
	}

	public getAcks() {
		return this.acks;
	}

	public commit() {
		this.committed = true;
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

// TODO peerPool and Signaler should have some methods to create them before connecting
export class LogObserver extends EventTarget {
	private peerPool?: PeerPool;
	private signaler?: Signaler;

	private type: LogObserverType;
	private ownId?: ClusterMemberId;
	private votedFor?: ClusterMemberId;

	private currentTerm: number;
	private leaderId: ClusterMemberId;
	private log: (ObservedLogEntry<string> | null)[]; // TODO generify the Observed log entry
	private idxLastReplicated: number; // the highest log entry known to be replicated on a quorum of machines
	private idxLastApplied: number; // the highest log entry that was applied to the state machine (in our case, dispatched to the component)

	private peerCount: number; // invariant -> on a leader, this is up to date.

	// only present if observer is leader
	private followerState?: {
		[serverId: ClusterMemberId]: {
			idxNextEntryToAppend: number;
			idxLastEntryAppended: number;
			lastAppendMessageTimestamp: number;
		};
	};

	private electionTimeoutMs: number;
	private heartbeatIntervalMs: number;
	private heartbeatInterval?: number;
	private electionTimeout?: number;

	public constructor() {
		super();
		// initial state
		this.type = 'FOLLOWER';
		this.currentTerm = 0;
		this.leaderId = '';
		this.peerCount = 0;
		this.log = [null]; // start with one null entry. The first proper entry will be at index 1.
		this.idxLastReplicated = 0;
		this.idxLastApplied = 0;
		this.electionTimeoutMs = getRandomNumberInRange(3000, 5000);
		this.heartbeatIntervalMs = 2000; // must be below election interval, otherwise elections will be triggered.

		// TODO workout when to start triggering this.
		this.resetElectionTimeout();
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

	public isReady(): boolean {
		// ready to accept entries if you are not a candidate
		return this.type !== 'CANDIDATE';
	}

	private initPeerPool(ownId: ClusterMemberId) {
		this.ownId = ownId;
		// TODO probably a way to not have to put `!` to tell TS that we have a signaler
		this.peerPool = new PeerPool(ownId, this.signaler!);

		this.peerPool.addEventListener('peerConnected', (event: any) => {
			console.log(`Peer ${event.detail.peerId} connected`);
			this.state.peerCount += 1;

			const dispatch = new CustomEvent('peerConnected', {
				detail: {}
			});

			this.dispatchEvent(dispatch);
		});

		this.peerPool.addEventListener('peerDisconnected', (event: any) => {
			console.log(`Peer ${event.detail.peerId} disconnected`);
			this.state.peerCount -= 1;

			const dispatch = new CustomEvent('peerDisconnected', { detail: {} });
			this.dispatchEvent(dispatch);
		});

		this.peerPool.addEventListener('newMessage', (event: any) => {
			console.log('New message event received:', event.detail);
			this.processIncomingMessage(event.detail.peerId, event.detail.message);
		});
	}

	// Deserialize and route message to correct processor
	private processIncomingMessage(fromPeerId: string, message: string) {
		try {
			const parsedMessage = JSON.parse(message);
			const messageType = parsedMessage.type;

			switch (messageType) {
				case 'AppendEntryRequest':
					const appendEntryMsg = new AppendEntryMessage(
						parsedMessage.term,
						parsedMessage.leaderId,
						parsedMessage.prevLogIndex,
						parsedMessage.prevLogTerm,
						parsedMessage.newLogEntries,
						parsedMessage.leaderCommitIndex
					);
					this.handleAppendEntryMessage(fromPeerId, appendEntryMsg);
					break;

				case 'AppendEntryResponse':
					const appendEntryResponse = new AppendEntryResponse(
						parsedMessage.term,
						parsedMessage.success
					);

					this.handleAppendEntryResponse(fromPeerId, appendEntryResponse);
					break;

				case 'RequestElectionMessage':
					const requestElectionMsg = new RequestElectionMessage(
						parsedMessage.term,
						parsedMessage.candidateId,
						parsedMessage.prevLogIndex,
						parsedMessage.prevLogTerm
					);
					this.handleRequestElectionMessage(fromPeerId, requestElectionMsg);
					break;

				case 'RequestElectionResponse':
					const requestElectionResponse = new RequestElectionResponse(
						parsedMessage.term,
						parsedMessage.voteGranted
					);
					this.handleRequestElectionResponse(fromPeerId, requestElectionResponse);
					break;

				case 'RequestAppendMessage':
					const requestAppendMsg = new RequestAppendMessage(parsedMessage.msg);
					this.handleRequestAppendMessage(fromPeerId, requestAppendMsg);
					break;

				case 'RequestSnapshotMessage':
					// TBD
					console.log('RequestSnapshotMessage received but not implemented');
					break;

				default:
					console.error(`Unknown message type: ${messageType}`, parsedMessage);
			}
		} catch (error) {
			console.error('Error processing message:', error);
			console.error('Original message:', message);
		}
	}

	// ================= APPEND ENTRY ==================
	public appendEntry(entry: string) {
		switch (this.type) {
			case 'LEADER':
				// append to my log
				const newEntry = new ObservedLogEntry(entry, this.currentTerm);
				this.log.push(newEntry);

				// for each follower, send if the index of the next entry to append matches the index that I've just appended
				for (const followerId of Object.keys(this.followerState!)) {
					const follower = this.followerState![followerId];

					if (this.log.length - 1 === follower.idxNextEntryToAppend) {
						this.appendToFollowerLog(followerId, follower.idxNextEntryToAppend);
					}
				}
				break;
			case 'FOLLOWER':
				// ask leader to append the message
				const msg = new RequestAppendMessage(entry);
				this.peerPool!.sendMessage(this.leaderId, msg);
				break;
			case 'CANDIDATE':
				throw new Error('Not ready to accept write requests');
			default:
				throw new Error(`Unknown LogObserverType: ${this.type}`);
		}
	}

	private handleAppendEntryMessage(fromPeerId: string, message: AppendEntryMessage) {
		// check the term, if I am on an older term, update and transition to follower
		if (message.term > this.currentTerm) {
			// the cluster has moved on, I should be a follower.
			this.currentTerm = message.term;
			this.transitionTo('FOLLOWER');
			this.leaderId = message.leaderId;
			return;
		}

		if (message.term < this.currentTerm) {
			// ignore message, received from an older leader
			return;
		}

		switch (this.type) {
			case 'CANDIDATE':
				this.transitionTo('FOLLOWER');
				this.leaderId = message.leaderId;
				break;
			case 'LEADER':
				// split brain scenario
				throw new Error(
					`Current node with id ${this.ownId} is a leader but received an AppendEntryMessage from another leader with id ${fromPeerId}. This indicates a split-brain scenario.`
				);
		}

		// here I am a follower of the current leader
		// first I need to check if the previousLogEntry in the message matches mine
		const prevLogEntry = this.log[message.prevLogIndex];

		if (prevLogEntry?.term != message.prevLogTerm) {
			// divergent log histories
			const msg = new AppendEntryResponse(this.currentTerm, false);
			this.peerPool?.sendMessage(this.leaderId, msg);
			return;
		}

		if (message.newLogEntry === null) {
			// heartbeat
			this.resetElectionTimeout();
			return;
		}

		const newEntry = new ObservedLogEntry(message.newLogEntry, this.currentTerm);
		const idxNewEntry = message.prevLogIndex + 1;

		/* 
			Two cases here 
				- Append: this entry is new, so it's index will be outside my bounds
				- Overwrite: my logs have diverged, and so I am overwriting an older entry
		*/
		if (idxNewEntry >= this.log.length) {
			// appending
			this.log.push(newEntry);
		} else {
			// overwriting
			this.log[idxNewEntry] = newEntry;
		}

		this.idxLastReplicated = Math.min(idxNewEntry, message.leaderLastReplicatedIndex);

		while (this.idxLastApplied !== this.idxLastReplicated) {
			const idxToApply = this.idxLastApplied + 1;
			const entry = this.log[idxToApply]!;

			if (!entry.committed) {
				entry.commit();

				// TODO make a private method for this
				const dispatch = new CustomEvent('newLogEntry', {
					detail: {
						entry: entry.entry
					}
				});

				this.dispatchEvent(dispatch);
			}

			this.idxLastApplied += 1;
		}

		const msg = new AppendEntryResponse(this.currentTerm, true);
		this.peerPool?.sendMessage(this.leaderId, msg);
	}

	private handleAppendEntryResponse(fromPeerId: string, message: AppendEntryResponse) {
		if (message.term > this.currentTerm) {
			// the cluster has moved on, I should be a follower.
			this.currentTerm = message.term;
			this.transitionTo('FOLLOWER');
			return;
		}

		if (message.term < this.currentTerm) {
			// ignore message, the inconsistent follower will eventually catch up
			// the next heartbeat from the leader should tell them what term we are on
			return;
		}

		if (!(this.type === 'LEADER')) {
			// for some reason, I am no longer the lead, so I don't care about your message
			console.error(
				`Got an appendEntryResponse but node is no longer the leader. From peer id: ${fromPeerId}; message: ${message}`
			);
			return;
		}

		const followerState = this.followerState![fromPeerId];

		if (message.success) {
			// log entry successfully appended to the log of the follower
			// At this point, the idxNextEntryToAppend currently points to the entry that was *just* appended in the follower log
			const idxEntry = followerState.idxNextEntryToAppend;

			/*
				Bookkeeping for the log entry should be done:
				- Increment the number of acknowledgments (acks).
				- If the entry is not yet committed and the number of acks exceeds the quorum size:
					- Commit the entry.
					- Dispatch a message with the committed entry.
				- Update the last committed entry index.
			*/
			const entry = this.log[idxEntry]!;
			entry.acks += 1;

			if (!entry.committed && entry.acks >= this.getQuorumSize()) {
				entry.commit();
				this.idxLastReplicated = idxEntry;

				const dispatch = new CustomEvent('newLogEntry', {
					detail: {
						entry: entry.entry
					}
				});

				this.dispatchEvent(dispatch);
				// dispatching the message is equivalent to applying the entry to the state machine
				this.idxLastApplied = idxEntry;
			}

			/*
				Follower bookkeeping should now be done:
				- follower.idxLastEntryAppended should be set to idxEntry.
				- follower.idxNextEntryToAppend should be incremented.
			*/

			followerState.idxLastEntryAppended = idxEntry;
			followerState.idxNextEntryToAppend += 1;

			/*
				After incrementing, check if the follower is behind the last appended entry.
				If so, send the next entry.
			*/
			if (this.log.length - 1 >= followerState.idxNextEntryToAppend) {
				this.appendToFollowerLog(fromPeerId, followerState.idxNextEntryToAppend);
			}
		} else {
			/* 
				Log inconsistency, catch up the peer
				- Find the first divergent index by decrementing followerState.idxLastEntryToAppend
				- And sending the message
			*/

			followerState.idxNextEntryToAppend -= 1;
			this.appendToFollowerLog(fromPeerId, followerState.idxNextEntryToAppend);
		}
	}

	private handleRequestAppendMessage(fromPeerId: string, message: RequestAppendMessage) {
		// this is client request to add a message to the shared log
		this.appendEntry(message.msg);
	}

	// ================= REQUEST ELECTION ==================
	// private requestElection() {}

	private handleRequestElectionMessage(fromPeerId: string, message: RequestElectionMessage) {
		const termIsGreaterThanOrEqual = message.term < this.state.currentTerm;

		const isLogUpToDate =
			message.lastLogEntryMetadata.term === this.state.currentTerm &&
			message.lastLogEntryMetadata.index === this.state.idxLastAppended;

		const voteGranted = this.votedFor === undefined && termIsGreaterThanOrEqual && isLogUpToDate;

		this.peerPool!.sendMessage(
			fromPeerId,
			new RequestElectionResponse(this.state.currentTerm, voteGranted)
		);

		this.votedFor = fromPeerId;
	}

	private handleRequestElectionResponse(fromPeerId: string, message: RequestElectionResponse) {}

	// ================= PRIVATE METHODS ==================
	private transitionTo(type: LogObserverType) {
		// cases
		// I am already at that type
		// any -> LEADER
		// any -> CANDIDATE
		// any -> FOLLOWER
		this.type = 'FOLLOWER';
		this.followerState = undefined;
		this.resetElectionTimeout(); // restart election interval
	}

	private requestElection() {
		// TODO
	}

	private resetElectionTimeout() {
		clearTimeout(this.electionTimeout);

		this.electionTimeout = setTimeout(() => {
			console.log('No heartbeat detected, triggering election');
			this.requestElection();
		}, this.electionTimeoutMs);
	}

	private sendHeartbeat() {
		for (const followerId of Object.keys(this.followerState!)) {
			const follower = this.followerState![followerId];
			const timeSinceLastAppendMsg = performance.now() - follower.lastAppendMessageTimestamp;

			if (timeSinceLastAppendMsg < this.heartbeatIntervalMs) {
				continue;
			}

			const prevIndex = follower.idxNextEntryToAppend - 1;
			const prevEntry = this.log[prevIndex];
			const prevTerm = prevEntry === null ? null : prevEntry.term;

			const msg = new AppendEntryMessage(
				this.currentTerm,
				this.ownId!,
				prevIndex,
				prevTerm,
				null,
				this.idxLastApplied
			);

			this.peerPool!.sendMessage(followerId, msg);
		}
	}

	private setLeaderHeartbeatInterval() {
		clearInterval(this.heartbeatInterval);

		this.heartbeatInterval = setInterval(() => {
			console.log('Sending heartbeat to followers');
			this.sendHeartbeat();
		}, this.heartbeatIntervalMs);
	}

	private appendToFollowerLog(followerId: ClusterMemberId, entryIndex: number) {
		this.followerState![followerId].lastAppendMessageTimestamp = performance.now();

		const currentEntry = this.log[entryIndex]!.entry;

		const prevIndex = entryIndex - 1;
		const prevEntry = this.log[prevIndex];
		const prevTerm = prevEntry === null ? null : prevEntry.term;

		const msg = new AppendEntryMessage(
			this.currentTerm,
			this.ownId!,
			prevIndex,
			prevTerm,
			currentEntry,
			this.idxLastApplied
		);

		this.peerPool!.sendMessage(followerId, msg);
	}

	private getQuorumSize() {
		return Math.floor(this.getPeerCount() / 2) + 1;
	}
}
