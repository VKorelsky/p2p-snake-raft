import { PeerPool } from '$lib/rtc/peerPool';
import { Signaler } from '$lib/rtc/signaler';
import type { Serializable } from '$lib/types';
import { getRandomNumberInRange } from '$lib/utils';
import {
	AppendEntryMessage,
	AppendEntryResponse,
	RequestAppendMessage,
	RequestElectionMessage,
	RequestElectionResponse
} from './message';

// events that will be shared with wider world
interface ObserverEvent<T> extends Event {
	detail: T;
	[key: string]: any;
}

// newLogEntry
interface NewLogEntryEvent<T> extends ObserverEvent<{ entry: T }> {}

// observerTypeChanged
interface ObserverTypeChangeEvent
	extends ObserverEvent<{
		term: number;
		newType: LogObserverType;
	}> {}

// peerConnected
interface NewPeerConnected extends ObserverEvent<{}> {}

// peerDisconnected
interface PeerDisconnected extends ObserverEvent<{}> {}

// clusterReady i.e election triggered
interface ClusterReady extends ObserverEvent<{}> {}

type LogObserverType = 'LEADER' | 'FOLLOWER' | 'CANDIDATE';
type ClusterMemberId = string;

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

export class LogObserver extends EventTarget {
	private peerPool: PeerPool;
	private signaler: Signaler;

	private type: LogObserverType;
	private ownId?: ClusterMemberId;
	private votedFor: ClusterMemberId;
	private nbVotes: number; // votes received when node was in candidate state

	private currentTerm: number;
	private leaderId: ClusterMemberId;
	private log: (ObservedLogEntry<string> | null)[]; // TODO generify the Observed log entry
	private idxLastReplicated: number; // the highest log entry known to be replicated on a quorum of machines
	private idxLastApplied: number; // the highest log entry that was applied to the state machine (in our case, dispatched to the component)

	// only present if observer is leader
	private followerState: {
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

	private nbPeers = 1; // Current node counts as one peer
	private minClusterSize = 3;

	public constructor(electionTimeoutMs : number) {
		super();

		// SIGNALER
		// TODO remove the hardcoded roomID
		this.signaler = new Signaler('697d8c94-cee3-4a99-a3b6-b7cced7927fc');

		this.signaler.onReady(() => {
			this.signaler.onConnect((sessionIdentifier) => (this.ownId = sessionIdentifier));
			this.signaler.onConnectError((err) => console.error(err));
		});

		// PEER POOL
		this.peerPool = new PeerPool(this.signaler);
		this.peerPool.addEventListener('peerConnected', (event: any) => {
			this.nbPeers += 1;

			if (this.nbPeers >= this.minClusterSize) {
				console.log('[OBSERVER] Minimum cluster size reached. Starting election process.');

				const clusterReadyEvent: ClusterReady = new CustomEvent('ready', {
					detail: {}
				});
				this.dispatchEvent(clusterReadyEvent);

				this.start();
			}

			const dispatch: NewPeerConnected = new CustomEvent('peerConnected', {
				detail: {}
			});

			this.dispatchEvent(dispatch);
		});

		this.peerPool.addEventListener('peerDisconnected', (event: any) => {
			const dispatch: PeerDisconnected = new CustomEvent('peerDisconnected', { detail: {} });
			this.dispatchEvent(dispatch);
		});

		this.peerPool.addEventListener('newMessage', (event: any) => {
			this.processIncomingMessage(event.detail.peerId, event.detail.message);
		});

		// INITIAL NODE STATE
		this.type = 'FOLLOWER';
		this.currentTerm = 0;
		this.leaderId = '';
		this.votedFor = '';
		this.nbVotes = 0;
		this.followerState = {};
		this.electionTimeoutMs = electionTimeoutMs;
		this.heartbeatIntervalMs = 5000; // must be below election interval, otherwise elections will be triggered.

		// INITIAL LOG STATE
		this.log = [null]; // start with one null entry. The first proper entry will be at index 1.
		this.idxLastReplicated = 0;
		this.idxLastApplied = 0;
	}

	public connect() {
		this.signaler.connect();
	}

	/*
		Since we are not currently handling cluster membership changes gracefully 
		each node is going to wait until the number of peers is a certain amount then set it's election timeout
	*/
	private start() {
		this.resetElectionTimeout();
	}

	public leave(): void {
		console.log('[OBSERVER] disconnecting from the signaler...');

		if (!this.signaler) {
			console.log('Not connected, nothing to disconnect from');
			return;
		}

		this.signaler.close();

		if (this.peerPool) {
			this.peerPool.close();
		}
	}

	public getPeerCount(): number {
		return this.peerPool.getConnectedPeerCount();
	}

	public getOwnId() {
		return this.ownId;
	}

	public getObserverType(): LogObserverType {
		return this.type;
	}

	public isReady(): boolean {
		// ready to accept entries if you are not a candidate
		return this.type !== 'CANDIDATE';
	}

	// Deserialize and route message to correct processor
	private processIncomingMessage(fromPeerId: string, message: string) {
		try {
			const parsedMessage = JSON.parse(message);
			const messageType = parsedMessage.type;

			switch (messageType) {
				case 'AppendEntryRequest':
					console.log('[OBSERVER] received append entry request', parsedMessage);
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
					console.log('[OBSERVER] received append entry response', parsedMessage);
					const appendEntryResponse = new AppendEntryResponse(
						parsedMessage.term,
						parsedMessage.success
					);

					this.handleAppendEntryResponse(fromPeerId, appendEntryResponse);
					break;

				case 'RequestElectionMessage':
					console.log('[OBSERVER] received request election message', parsedMessage);
					const requestElectionMsg = new RequestElectionMessage(
						parsedMessage.term,
						parsedMessage.candidateId,
						parsedMessage.prevLogIndex,
						parsedMessage.prevLogTerm
					);
					this.handleRequestElectionMessage(fromPeerId, requestElectionMsg);
					break;

				case 'RequestElectionResponse':
					console.log('[OBSERVER] received request election response', parsedMessage);
					const requestElectionResponse = new RequestElectionResponse(
						parsedMessage.term,
						parsedMessage.voteGranted
					);
					this.handleRequestElectionResponse(fromPeerId, requestElectionResponse);
					break;

				case 'RequestAppendMessage':
					console.log('[OBSERVER] received request append message', parsedMessage);
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
				for (const followerId of Object.keys(this.followerState)) {
					const follower = this.followerState[followerId];

					if (this.log.length - 1 === follower.idxNextEntryToAppend) {
						this.appendToFollowerLog(followerId, follower.idxNextEntryToAppend);
					}
				}
				break;
			case 'FOLLOWER':
				// ask leader to append the message
				const msg = new RequestAppendMessage(entry);
				this.peerPool.sendMessage(this.leaderId, msg);
				break;
			case 'CANDIDATE':
				throw new Error('Not ready to accept write requests');
			default:
				throw new Error(`Unknown LogObserverType: ${this.type}`);
		}
	}

	private handleAppendEntryMessage(fromPeerId: string, message: AppendEntryMessage) {
		// check the term, if I am on an older term, update and transition to follower
		// TODO can probably handle both the case where I am a candidate or a follower in this one
		if (message.term > this.currentTerm) {
			// the cluster has moved on, I should be a follower if I am not already
			this.currentTerm = message.term;
			this.transitionTo('FOLLOWER', { newLeaderId: message.leaderId });
		}

		if (message.term < this.currentTerm) {
			// ignore message, received from an older leader
			return;
		}

		switch (this.type) {
			case 'CANDIDATE':
				this.transitionTo('FOLLOWER', { newLeaderId: message.leaderId });
				break;
			case 'LEADER':
				// split brain scenario
				throw new Error(
					`Current node with id ${this.ownId} is a leader but received an AppendEntryMessage from another leader with id ${fromPeerId}. This indicates a split-brain scenario.`
				);
		}

		this.resetElectionTimeout();

		/*
			When the cluster first initializes, the leader id is not set.
			All nodes start as followers and it will happen that they will stay followers until they hear from the first elected leader
			When they do, they should update their id
		*/
		if (!this.leaderId) {
			this.leaderId = message.leaderId;
			// thought: to make this a little nicer, I can likely use the transition method upon node initialization instead
			this.dispatchObserverStateEvent();
		}

		// here I am a follower of the current leader
		// first I need to check if the previousLogEntry in the message matches mine
		const prevLogEntry = this.log[message.prevLogIndex];
		const prevLogEntryTerm = prevLogEntry ? prevLogEntry.term : this.currentTerm;

		if (prevLogEntryTerm != message.prevLogTerm) {
			// divergent log histories
			const msg = new AppendEntryResponse(this.currentTerm, false);
			this.peerPool?.sendMessage(this.leaderId, msg);
			return;
		}

		if (message.newLogEntry === null) {
			// heartbeat
			const msg = new AppendEntryResponse(this.currentTerm, true);
			this.peerPool?.sendMessage(this.leaderId, msg);
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
				this.applyEntry(entry.entry);
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

		// I received a response/acknowledgement from some other node in the clusterr
		this.resetElectionTimeout();

		if (message.term < this.currentTerm) {
			// ignore message, the inconsistent follower will eventually catch up
			// the next heartbeat from the leader should tell them what term we are on
			return;
		}

		if (this.type !== 'LEADER') {
			// for some reason, I am no longer the lead, so I don't care about your message
			console.error(
				`Got an appendEntryResponse but node is no longer the leader. From peer id: ${fromPeerId}; message: ${message}`
			);
			return;
		}

		const followerState = this.followerState[fromPeerId];

		// In the case of a heartbeat, the follower is going to be up to date
		// this means that the index of the entry will be equal to the last entry in the leader log
		if (message.success) {
			// log entry successfully appended to the log of the follower
			// At this point, the idxNextEntryToAppend currently points to the entry that was *just* appended in the follower log
			const idxEntry = followerState.idxNextEntryToAppend;

			if (idxEntry === this.log.length) {
				// we are getting a response to an empty heartbeat, so no need to update anything
				return;
			}

			/*
				Bookkeeping for the log entry should be done:
				- Increment the number of acknowledgments (acks).
				- If the entry is not yet committed and the number of acks exceeds the quorum size:
					- Commit the entry.
					- Dispatch a message with the committed entry.
				- Update the last committed entry index.
			*/
			const entry = this.log[idxEntry]!;

			// the first entry in the log is null
			if (entry) {
				entry.acks += 1;

				if (!entry.committed && entry.acks >= this.getQuorumSize()) {
					entry.commit();
					this.idxLastReplicated = idxEntry;
					this.applyEntry(entry.entry);
					// dispatching the message is equivalent to applying the entry to the state machine
					this.idxLastApplied = idxEntry;
				}
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

	private handleRequestAppendMessage(_: string, message: RequestAppendMessage) {
		// this is client request to add a message to the shared log
		this.appendEntry(message.msg);
	}

	// ================= REQUEST ELECTION ==================
	private requestElection() {
		console.log('[OBSERVER] Requesting election');
		this.currentTerm += 1;
		this.votedFor = this.ownId!;
		this.nbVotes = 1;
		this.resetElectionTimeout();

		const idxLastEntry = this.log.length - 1;
		const lastEntry = this.log[idxLastEntry];

		// the first entry has no term, so we should start like this
		const lastEntryTerm = lastEntry ? lastEntry.term : this.currentTerm;

		const msg = new RequestElectionMessage(
			this.currentTerm,
			this.ownId!,
			idxLastEntry,
			lastEntryTerm
		);

		this.peerPool.broadcast(msg);
	}

	private handleRequestElectionMessage(fromPeerId: string, message: RequestElectionMessage) {
		if (message.term < this.currentTerm) {
			// ignore, this is a stale node
			this.denyVote(fromPeerId);
			return;
		}

		if (message.term >= this.currentTerm) {
			this.currentTerm = message.term;
		}

		const lastEntry = this.log[this.log.length - 1];
		const lastEntryTerm = lastEntry ? lastEntry.term : this.currentTerm;

		const isCandidateLogUpToDate =
			(message.termLastLogEntry === lastEntryTerm &&
				message.idxLastLogEntry >= this.log.length - 1) ||
			lastEntryTerm > message.termLastLogEntry;

		const voteCanBeGranted = this.votedFor === '' || this.votedFor === message.candidateId;

		if (isCandidateLogUpToDate && voteCanBeGranted) {
			this.grantVote(message.candidateId);
			this.resetElectionTimeout();
		} else {
			this.denyVote(message.candidateId);
		}
	}

	private handleRequestElectionResponse(_: string, message: RequestElectionResponse) {
		if (message.term > this.currentTerm) {
			this.currentTerm = message.term;
			this.transitionTo('FOLLOWER', { newLeaderId: '' }); // Unknown leader. We will wait for a heartbeat
			return;
		}

		if (message.voteGranted) {
			this.nbVotes += 1;

			if (this.nbVotes >= this.getQuorumSize() && this.type !== 'LEADER') {
				this.transitionTo('LEADER');
			}

			return;
		}

		// do nothing, wait until you time out again and trigger a new election or another peer triggers an election
	}

	private grantVote(candidateId: ClusterMemberId) {
		this.votedFor = candidateId;
		this.peerPool.sendMessage(candidateId, new RequestElectionResponse(this.currentTerm, true));
	}

	private denyVote(candidateId: ClusterMemberId) {
		this.peerPool.sendMessage(candidateId, new RequestElectionResponse(this.currentTerm, false));
	}

	private transitionTo(type: LogObserverType, context: { newLeaderId: ClusterMemberId } | {} = {}) {
		console.log(`[OBSERVER] Transitioning from ${this.type} to ${type}`, this);
		// reset variables that should be fresh at the start of a new term
		this.votedFor = '';
		this.followerState = {};
		clearInterval(this.heartbeatInterval);
		this.resetElectionTimeout();

		switch (type) {
			case 'CANDIDATE':
				// Become a candidate and request an election
				this.type = 'CANDIDATE';
				this.requestElection();
				break;
			case 'LEADER':
				this.type = 'LEADER';
				Object.keys(this.peerPool.getOpenPeers()).forEach((peer) => {
					console.log(
						`[OBSERVER] Affirming leader status to peer with id: ${peer}`,
						Object.keys(this.peerPool.getOpenPeers())
					);

					this.followerState[peer] = {
						idxNextEntryToAppend: this.log.length, // initialized to leader last log index + 1
						idxLastEntryAppended: 0,
						lastAppendMessageTimestamp: 0
					};

					// TODO the last log entry may not be set and this is the cause of much grief since the term is null
					// should refactor and make this type safe
					const lastEntry = this.getLastLogEntry();
					const lastEntryTerm = lastEntry ? lastEntry.term : this.currentTerm;

					this.sendHeartbeat(peer, this.log.length, lastEntryTerm);
				});
				this.setLeaderHeartbeatInterval();
				break;
			case 'FOLLOWER':
				this.type = 'FOLLOWER';

				// this is somewhat ugly
				if ('newLeaderId' in context) {
					this.leaderId = context.newLeaderId;
				} else {
					throw new Error('Leader ID must be provided when transitioning to FOLLOWER');
				}

				break;
		}

		this.dispatchObserverStateEvent();
	}

	private dispatchObserverStateEvent() {
		const event: ObserverTypeChangeEvent = new CustomEvent('observerStateChange', {
			detail: { term: this.currentTerm, newType: this.type }
		});

		this.dispatchEvent(event);
	}

	private getLastLogEntry(): ObservedLogEntry<any> {
		// refactor to use this
		return this.log[this.log.length - 1]!;
	}

	private resetElectionTimeout() {
		console.log('[OBSERVER] Resetting the election timeout');
		clearTimeout(this.electionTimeout);

		this.electionTimeout = setTimeout(() => {
			console.log('[OBSERVER] No heartbeat or acknowledgments detected, triggering election');
			this.transitionTo('CANDIDATE');
		}, this.electionTimeoutMs);
	}

	private setLeaderHeartbeatInterval() {
		clearInterval(this.heartbeatInterval);

		this.heartbeatInterval = setInterval(() => {
			console.log('[OBSERVER] Sending heartbeat to followers');
			this.sendHeartbeats();
		}, this.heartbeatIntervalMs);
	}

	private sendHeartbeat(followerId: ClusterMemberId, prevIndex: number, prevTerm: number) {
		this.followerState[followerId].lastAppendMessageTimestamp = performance.now();

		const msg = new AppendEntryMessage(
			this.currentTerm,
			this.ownId!,
			prevIndex,
			prevTerm,
			null,
			this.idxLastApplied
		);

		this.peerPool.sendMessage(followerId, msg);
	}

	private sendHeartbeats() {
		for (const followerId of Object.keys(this.followerState)) {
			const follower = this.followerState[followerId];
			const timeSinceLastAppendMsg = performance.now() - follower.lastAppendMessageTimestamp;

			if (timeSinceLastAppendMsg < this.heartbeatIntervalMs) {
				continue;
			}

			// if follower is not up to date, the heartbeat will behave like a retry

			const prevIndex = follower.idxNextEntryToAppend - 1;
			const prevEntry = this.log[prevIndex];
			const prevTerm = prevEntry ? prevEntry.term : this.currentTerm;

			this.sendHeartbeat(followerId, prevIndex, prevTerm);
		}
	}

	private appendToFollowerLog(followerId: ClusterMemberId, entryIndex: number) {
		this.followerState[followerId].lastAppendMessageTimestamp = performance.now();

		const currentEntry = this.log[entryIndex]!.entry;

		const prevIndex = entryIndex - 1;
		const prevEntry = this.log[prevIndex];
		const prevTerm = prevEntry ? prevEntry.term : this.currentTerm;

		const msg = new AppendEntryMessage(
			this.currentTerm,
			this.ownId!,
			prevIndex,
			prevTerm,
			currentEntry,
			this.idxLastApplied
		);

		this.peerPool.sendMessage(followerId, msg);
	}

	private getQuorumSize() {
		return Math.floor(this.getPeerCount() / 2) + 1;
	}

	private applyEntry(entry: string) {
		const dispatch = new CustomEvent('newLogEntry', {
			detail: {
				entry: entry
			}
		});

		this.dispatchEvent(dispatch);
	}
}
