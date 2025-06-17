import type { NewMessageEvent } from '$lib/rtc/peerConnection';
import {
	PeerPool,
	type PeerPoolPeerConnectedEvent,
	type PeerPoolPeerDisconnectedEvent
} from '$lib/rtc/peerPool';
import { Signaler } from '$lib/rtc/signaler';
import { TypedEventTarget, type Serializable } from '$lib/types';
import {
	AppendEntryMessage,
	AppendEntryResponse,
	InstallSnapshotMessage,
	InstallSnapshotResponse,
	RequestAppendMessage,
	RequestElectionMessage,
	RequestElectionResponse
} from './message';
import { readSnapshot, writeSnapshot } from './snapshotManager';

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

type ClusterMemberId = string;
type LogObserverType = 'LEADER' | 'FOLLOWER' | 'CANDIDATE';

interface LogObserverEventMap {
	// eslint-disable-next-line @typescript-eslint/no-empty-object-type
	ready: CustomEvent<{}>;
	newLogEntry: CustomEvent<{ entry: string }>;
	newLogEntries: CustomEvent<{ entries: string[] }>;
	observerStateChange: CustomEvent<{ term: number; newType: LogObserverType }>;
	peerConnected: CustomEvent<{ peerCount: number }>;
	peerDisconnected: CustomEvent<{ peerCount: number }>;
}

export type ClusterReadyEvent = LogObserverEventMap['ready'];
export type NewLogEntryEvent = LogObserverEventMap['newLogEntry'];
export type NewLogEntriesEvent = LogObserverEventMap['newLogEntries'];
export type ObserverStateChangeEvent = LogObserverEventMap['observerStateChange'];
export type ObserverPeerConnectedEvent = LogObserverEventMap['peerConnected'];
export type ObserverPeerDisconnectedEvent = LogObserverEventMap['peerDisconnected'];

interface SnapshotPayload {
	term: number;
	leaderId: string;
	lastIncludedIndex: number;
	lastIncludedTerm: number;
	state: (ObservedLogEntry<string> | null)[];
}

export default class LogObserver extends TypedEventTarget<LogObserverEventMap> {
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

	// FIXME: what happens on disconnection?
	private electionTimeoutMs: number;
	private heartbeatIntervalMs: number;
	private heartbeatInterval?: number;
	private electionTimeout?: number;

	private nbPeers = 1; // Current node counts as one peer
	private minClusterSize = 3;

	// INITIAL SNAPSHOT STATE
	private logThreshold = 15;
	private lastSnapshotIndex = 0;
	private lastSnapshotTerm = 0;
	private logOffset = 0;

	public constructor(electionTimeoutMs: number) {
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
		this.peerPool.addEventListener('peerConnected', (event: PeerPoolPeerConnectedEvent) => {
			this.nbPeers += 1;

			if (this.nbPeers >= this.minClusterSize) {
				console.log('[OBSERVER] Minimum cluster size reached. Starting election process.');

				const clusterReadyEvent: ClusterReadyEvent = new CustomEvent('ready', {
					detail: {}
				});
				this.dispatchEvent(clusterReadyEvent);

				// check if observer is a leader, then add the new peer to their follower state
				const peerId = event.detail.peerId;

				if (this.type === 'LEADER' && !this.followerState[peerId]) {
					this.followerState[peerId] = {
						idxNextEntryToAppend: 1,
						idxLastEntryAppended: 0,
						lastAppendMessageTimestamp: 0
					};
				}

				this.start();
			}

			const dispatch: ObserverPeerConnectedEvent = new CustomEvent('peerConnected', {
				detail: {
					peerCount: this.nbPeers - 1
				}
			});

			this.dispatchEvent(dispatch);
		});

		this.peerPool.addEventListener('peerDisconnected', (event: PeerPoolPeerDisconnectedEvent) => {
			this.nbPeers -= 1;
			if (this.type === 'LEADER') {
				delete this.followerState[event.detail.peerId];
			}

			const dispatch: ObserverPeerDisconnectedEvent = new CustomEvent('peerDisconnected', {
				detail: {
					peerCount: this.nbPeers - 1
				}
			});
			this.dispatchEvent(dispatch);
		});

		this.peerPool.addEventListener('newMessage', (event: NewMessageEvent) => {
			this.processIncomingMessage(event.detail.peerId, event.detail.message as string);
		});

		// INITIAL NODE STATE
		this.type = 'FOLLOWER';
		this.currentTerm = 0;
		this.leaderId = '';
		this.votedFor = '';
		this.nbVotes = 0;
		this.followerState = {};
		this.electionTimeoutMs = electionTimeoutMs;
		this.heartbeatIntervalMs = 1000; // must be below election interval, otherwise elections will be triggered.

		// INITIAL LOG STATE
		this.log = [null]; // start with one null entry. The first proper entry will be at index 1.
		this.idxLastReplicated = 0;
		this.idxLastApplied = 0;
	}

	public connect() {
		console.log('connecting to circle server');
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

	public getClusterSize(): number {
		// adding one to include self
		return this.getPeerCount() + 1;
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
				case 'AppendEntryRequest': {
					const appendEntryMsg = new AppendEntryMessage(
						parsedMessage.term,
						parsedMessage.leaderId,
						parsedMessage.prevLogIndex,
						parsedMessage.prevLogTerm,
						parsedMessage.newLogEntry,
						parsedMessage.leaderCommitIndex
					);
					this.handleAppendEntryMessage(fromPeerId, appendEntryMsg);
					break;
				}
				case 'AppendEntryResponse': {
					const appendEntryResponse = new AppendEntryResponse(
						parsedMessage.term,
						parsedMessage.success
					);

					this.handleAppendEntryResponse(fromPeerId, appendEntryResponse);
					break;
				}
				case 'RequestElectionMessage': {
					const requestElectionMsg = new RequestElectionMessage(
						parsedMessage.term,
						parsedMessage.candidateId,
						parsedMessage.prevLogIndex,
						parsedMessage.prevLogTerm
					);
					this.handleRequestElectionMessage(fromPeerId, requestElectionMsg);
					break;
				}
				case 'RequestElectionResponse': {
					const requestElectionResponse = new RequestElectionResponse(
						parsedMessage.term,
						parsedMessage.voteGranted
					);
					this.handleRequestElectionResponse(fromPeerId, requestElectionResponse);
					break;
				}
				case 'RequestAppendMessage': {
					const requestAppendMsg = new RequestAppendMessage(parsedMessage.msg);
					this.handleRequestAppendMessage(fromPeerId, requestAppendMsg);
					break;
				}
				case 'InstallSnapshotRequest': {
					const installSnapshotMsg = new InstallSnapshotMessage(
						parsedMessage.term,
						parsedMessage.leaderId,
						parsedMessage.lastIncludedIndex,
						parsedMessage.lastIncludedTerm,
						parsedMessage.state,
					);
					this.handleInstallSnapshotRequest(fromPeerId, installSnapshotMsg);
					break;
				}
				case 'InstallSnapshotResponse': {
					const installSnaphotResponse = new InstallSnapshotResponse(
						parsedMessage.term,
						parsedMessage.lastIncludedIndex,
						parsedMessage.lastInstallTimestamp,
						parsedMessage.success
					);
					this.handleInstallSnapshotResponse(fromPeerId, installSnaphotResponse);
					break;
				}
				default:
					console.error(`Unknown message type: ${messageType}`, parsedMessage);
			}
		} catch (error) {
			console.error('Error processing message:', error);
			console.error('Original message:', message);
		}
	}

	// ================= APPEND ENTRY ==================
	public async appendEntry(entry: string) {
		switch (this.type) {
			case 'LEADER': {
				// append to my log
				const newEntry = new ObservedLogEntry(entry, this.currentTerm);
				this.log.push(newEntry);

				// for each follower, send if the index of the next entry to append matches the index that I've just appended
				for (const followerId of Object.keys(this.followerState)) {
					const follower = this.followerState[followerId];

					if (this.getLastGlobalIndex() === follower.idxNextEntryToAppend) {
						this.appendToFollowerLog(followerId, follower.idxNextEntryToAppend);
					}
				}
				break;
			}
			case 'FOLLOWER': {
				// ask leader to append the message
				const msg = new RequestAppendMessage(entry);
				this.peerPool.sendMessage(this.leaderId, msg);
				break;
			}
			case 'CANDIDATE': {
				throw new Error('Not ready to accept write requests');
			}
			default: {
				throw new Error(`Unknown LogObserverType: ${this.type}`);
			}
		}
	}

	private handleInstallSnapshotRequest(fromPeerId: string, message: InstallSnapshotMessage) {
		if (message.term < this.currentTerm || this.type !== 'FOLLOWER') {
			// ignore message, received from an older leader
			return;
		}

		this.resetElectionTimeout();

		this.currentTerm = message.term;
		this.log = [];
		this.logOffset = message.lastIncludedIndex + 1;
		this.lastSnapshotIndex = message.lastIncludedIndex;
		this.lastSnapshotTerm = message.lastIncludedTerm;
		this.idxLastApplied = message.lastIncludedIndex;
		this.idxLastReplicated = message.lastIncludedIndex;

		const msg = new InstallSnapshotResponse(
			this.currentTerm,
			this.idxLastApplied,
			performance.now(),
			true
		);

		this.peerPool.sendMessage(fromPeerId, msg);

		const entries = [...message.state].filter((entry) => entry !== null).map((entry) => entry.entry);
		this.applyEntries(entries);
	}

	private handleInstallSnapshotResponse(fromPeerId: string, message: InstallSnapshotResponse) {
		// update followerState with required values
		if (this.type !== 'LEADER') {
			// for some reason, I am no longer the lead, so I don't care about your message
			console.error(
				`Got an installSnapshotResponse but node is no longer the leader. From peer id: ${fromPeerId}; message: ${message}`
			);
			return;
		}

		this.resetElectionTimeout();

		if (message.success) {
			const followerState = this.followerState[fromPeerId];
			followerState.idxLastEntryAppended = message.lastIncludedIndex;
			followerState.idxNextEntryToAppend = message.lastIncludedIndex + 1;
			followerState.lastAppendMessageTimestamp = message.lastInstallTimestamp;
		}
	}

	private async handleAppendEntryMessage(fromPeerId: string, message: AppendEntryMessage) {
		// check the term, if I am on an older term, update and transition to follower
		// TODO can probably handle both the case where I am a candidate or a follower in this one
		if (message.term < this.currentTerm) {
			// ignore message, received from an older leader
			return;
		}

		switch (this.type) {
			case 'FOLLOWER':
				this.currentTerm = message.term;
				this.transitionTo('FOLLOWER', { newLeaderId: message.leaderId });
				break;
			case 'CANDIDATE':
				this.transitionTo('FOLLOWER', { newLeaderId: message.leaderId });
				break;
			case 'LEADER':
				// split brain scenario
				throw new Error(
					`Current node with id ${this.ownId} is a leader but received an AppendEntryMessage from another leader with id ${fromPeerId}. This indicates a split-brain scenario.`
				);
		}

		console.log(
			`[OBSERVER] Received AppendEntry from ${message.leaderId}. Resetting the election timeout`
		);
		console.log("LOG OFFSET ", this.logOffset);
		this.resetElectionTimeout();
		/*
			When the cluster first initializes, the leader id is not set.
			All nodes start as followers and it will happen that they will stay followers until they hear from the first elected leader
			When they do, they should update their id
		*/
		// if (!this.leaderId) {
		// 	this.transitionTo('FOLLOWER', { newLeaderId: message.leaderId });
		// }

		// here I am a follower of the current leader
		// first I need to check if the previousLogEntry in the message matches mine
		const prevLogEntry = this.getLogEntryByGlobalIndex(message.prevLogIndex);
		const prevLogEntryTerm = prevLogEntry ? prevLogEntry.term : this.currentTerm;

		if (prevLogEntryTerm != message.prevLogTerm) {
			// divergent log histories
			const msg = new AppendEntryResponse(this.currentTerm, false);
			this.peerPool.sendMessage(this.leaderId, msg);
			return;
		}

		console.log('FOLLOWER LOG ', this.log);
		console.log('SNAPSHOT INDEX ', this.lastSnapshotIndex);
		console.log('GLOBAL LAST IDX ', this.getLastGlobalIndex());

		// how to update the idx of the last replicated entry?
		if (message.newLogEntry) {
			const newEntry = new ObservedLogEntry(message.newLogEntry, this.currentTerm);
			const idxNewEntry = message.prevLogIndex + 1;
			// gotta calculate the local idx based on this global entry before inserting
			console.log('NEW LOG ENTRY ', message.toJson());

			/* 
			Two cases here 
				- Append: this entry is new, so it's index will be outside my bounds
				- Overwrite: my logs have diverged, and so I am overwriting an older entry
		*/
			if (idxNewEntry >= this.getLastGlobalIndex() + 1) {
				// appending
				this.log.push(newEntry);
			} else {
				// overwriting
				this.log[idxNewEntry] = newEntry;
			}

			this.idxLastReplicated = Math.min(idxNewEntry, message.leaderLastReplicatedIndex);
		} else {
			this.idxLastReplicated = Math.min(message.prevLogIndex, message.leaderLastReplicatedIndex);
		}

		while (this.idxLastApplied !== this.idxLastReplicated) {
			// last applied here will be the global last
			const idxToApply = this.idxLastApplied + 1;
			const entry = this.getLogEntryByGlobalIndex(idxToApply);

			if (entry && !entry.committed) {
				entry.commit();
				this.applyEntry(entry.entry);
				// Follower's lastAppliedIndex should only be updated if it received a non-empty appendEntry RPC
				this.idxLastApplied += 1;
			}
		}

		await this.maybeSnapshotAndTruncate()
		console.log(`[OBSERVER] SENDING APPEND ENTRY RESPONSE to leader with id ${this.leaderId}`);
		const msg = new AppendEntryResponse(this.currentTerm, true);
		this.peerPool.sendMessage(this.leaderId, msg);
	}

	private async handleAppendEntryResponse(fromPeerId: string, message: AppendEntryResponse) {
		if (message.term > this.currentTerm) {
			// the cluster has moved on, I should be a follower
			console.log(
				`[OBSERVER] [APPEND ENTRY RESPONSE] Changing term from ${this.currentTerm} to ${message.term}`
			);
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
			const globalLastIndex = this.getLastGlobalIndex();

			if (idxEntry === globalLastIndex + 1) {
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
			const entry = this.getLogEntryByGlobalIndex(idxEntry);
			if (!entry) {
				console.warn(`Missing entry at index ${idxEntry}`);
				return;
			}

			// the first entry in the log is null
			entry.acks += 1;

			if (!entry.committed && entry.acks >= this.getQuorumSize()) {
				entry.commit();
				this.idxLastReplicated = idxEntry;
				this.applyEntry(entry.entry);
				// dispatching the message is equivalent to applying the entry to the state machine
				this.idxLastApplied = idxEntry;
				// on receipt of the appendEntryResponse,
				await this.maybeSnapshotAndTruncate();
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
			if (followerState.idxNextEntryToAppend < globalLastIndex) {
				this.appendToFollowerLog(fromPeerId, followerState.idxNextEntryToAppend);
			}
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

		const idxLastEntry = this.getLastGlobalIndex();
		const lastEntry = this.getLogEntryByGlobalIndex(idxLastEntry);

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
		console.log(`[OBSERVER] Election requested by peer with id ${fromPeerId}.`);
		if (message.term < this.currentTerm) {
			// ignore, this is a stale node
			this.denyVote(fromPeerId);
			return;
		}

		if (message.term >= this.currentTerm) {
			console.log(
				`[OBSERVER] [REQUEST ELECTION MESSAGE] Changing term from ${this.currentTerm} to ${message.term}`
			);
			this.currentTerm = message.term;
			this.votedFor = '';

			this.dispatchObserverStateEvent();
		}

		const globalLastIndex = this.getLastGlobalIndex();
		const lastEntry = this.getLogEntryByGlobalIndex(globalLastIndex);
		const lastEntryTerm = lastEntry ? lastEntry.term : this.currentTerm;

		const isCandidateLogUpToDate =
			(message.termLastLogEntry === lastEntryTerm &&
				message.idxLastLogEntry >= globalLastIndex) ||
			lastEntryTerm > message.termLastLogEntry;

		const voteCanBeGranted = this.votedFor === '' || this.votedFor === message.candidateId;

		if (isCandidateLogUpToDate && voteCanBeGranted) {
			console.log(`[OBSERVER] Granting vote to peer with id ${fromPeerId}.`);
			this.grantVote(message.candidateId);
			this.resetElectionTimeout();
		} else {
			console.log(`[OBSERVER] Denying vote to peer with id ${fromPeerId}.`);
			this.denyVote(message.candidateId);
		}
	}

	private handleRequestElectionResponse(fromPeerId: string, message: RequestElectionResponse) {
		console.log(
			`[OBSERVER] Received vote result from peer with id ${fromPeerId}. Result is ${message.toJson()}`
		);
		if (message.term > this.currentTerm) {
			console.log(
				`[OBSERVER] [REQUEST ELECTION RESPONSE] Changing term from ${this.currentTerm} to ${message.term}`
			);
			this.currentTerm = message.term;
			this.transitionTo('FOLLOWER'); // Unknown leader. We will wait for a heartbeat
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

	private transitionTo(type: LogObserverType, context: { newLeaderId?: ClusterMemberId } = {}) {
		// console.log(`[OBSERVER] Transitioning from ${this.type} to ${type}`, this);
		// reset variables that should be fresh at the start of a new term
		this.votedFor = '';
		this.followerState = {};
		clearInterval(this.heartbeatInterval);
		clearTimeout(this.electionTimeout);

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
						idxNextEntryToAppend: this.getLastGlobalIndex() + 1, // initialized to leader last log index + 1
						idxLastEntryAppended: 0,
						lastAppendMessageTimestamp: 0
					};

					// TODO the last log entry may not be set and this is the cause of much grief since the term is null
					const lastEntryIndex = this.getLastGlobalIndex();
					const lastEntry = this.getLogEntryByGlobalIndex(lastEntryIndex);
					const lastEntryTerm = lastEntry ? lastEntry.term : this.currentTerm;

					this.sendHeartbeat(peer, lastEntryIndex, lastEntryTerm);
				});
				this.setLeaderHeartbeatInterval();
				break;
			case 'FOLLOWER':
				this.type = 'FOLLOWER';

				if (context['newLeaderId']) {
					this.leaderId = context.newLeaderId as string;
				} else {
					throw new Error('Leader ID must be provided when transitioning to FOLLOWER');
				}

				break;
		}

		this.dispatchObserverStateEvent();
	}

	private dispatchObserverStateEvent() {
		const event: ObserverStateChangeEvent = new CustomEvent('observerStateChange', {
			detail: { term: this.currentTerm, newType: this.type }
		});

		console.log('DISPATCHING observerStateChange EVENT');
		this.dispatchEvent(event);
	}

	private resetElectionTimeout() {
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
		try {
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
		} catch (error) {
			console.log(
				'[OBSERVER] Failed to send heartbeat to follower with id: ',
				followerId,
				' error: ',
				error
			);
		}
	}

	private async sendHeartbeats() {
		const globalLastIndex = this.getLastGlobalIndex();
		console.log("GLOBAL LAST INDEX ", globalLastIndex);
		console.log("LEADER LOG ", this.log);
		console.log("LEADER LOG OFFSET ", this.logOffset);
		// this loops the follower state object of the leader
		for (const followerId of Object.keys(this.followerState)) {
			const follower = this.followerState[followerId];
			const timeSinceLastAppendMsg = performance.now() - follower.lastAppendMessageTimestamp;
			console.log('FOLLOWER ID ', followerId);
			console.log('IDX LAST ENTRY APPENDED ', follower.idxLastEntryAppended);
			console.log('IDX NEXT ENTRY TO APPEND ', follower.idxNextEntryToAppend);

			if (timeSinceLastAppendMsg < this.heartbeatIntervalMs) {
				continue;
			}

			if (follower.idxNextEntryToAppend <= this.lastSnapshotIndex) {
				const snapshot = await readSnapshot();
				if (snapshot) {
					console.log('[OBSERVER] SENDING LATEST SNAPSHOT TO FOLLOWER ID: ', followerId);

					const { lastIncludedIndex, lastIncludedTerm, state } = snapshot;
					const snapshotPayload = {
						term: this.currentTerm,
						leaderId: this.ownId as string,
						lastIncludedIndex,
						lastIncludedTerm,
						state,
					};

					this.sendSnapshotMessage(followerId, snapshotPayload);
					continue;
				}
			}

			if (follower.idxNextEntryToAppend <= globalLastIndex) {
				this.appendToFollowerLog(followerId, follower.idxNextEntryToAppend);
				continue;
			}

			// if follower is not up to date, the heartbeat will behave like a retry
			const prevIndex = follower.idxNextEntryToAppend - 1;
      const prevEntry = this.getLogEntryByGlobalIndex(prevIndex);
			const prevTerm = prevEntry ? prevEntry.term : this.lastSnapshotTerm;

			this.sendHeartbeat(followerId, prevIndex, prevTerm);
		}
	}

	private appendToFollowerLog(followerId: ClusterMemberId, entryIndex: number) {
		this.followerState[followerId].lastAppendMessageTimestamp = performance.now();

		const entryObject = this.getLogEntryByGlobalIndex(entryIndex);
    if (!entryObject) throw new Error(`No entry at ${entryIndex}`);

		const prevIndex = entryIndex - 1;
    const prevEntry = this.getLogEntryByGlobalIndex(prevIndex);
    const prevTerm = prevEntry ? prevEntry.term : this.currentTerm;

		const msg = new AppendEntryMessage(
			this.currentTerm,
			this.ownId!,
			prevIndex,
			prevTerm,
			entryObject.entry,
			this.idxLastApplied
		);

		this.peerPool.sendMessage(followerId, msg);
	}

	private sendSnapshotMessage(followerId: ClusterMemberId, payload: SnapshotPayload) {
		const msg = new InstallSnapshotMessage(
			payload.term,
			payload.leaderId,
			payload.lastIncludedIndex,
			payload.lastIncludedTerm,
			payload.state,
		);

		this.peerPool.sendMessage(followerId, msg);
	}

	private getQuorumSize() {
		return Math.floor(this.getClusterSize() / 2) + 1;
	}

	private applyEntry(entry: string) {
		const dispatch = new CustomEvent('newLogEntry', {
			detail: {
				entry: entry
			}
		});

		this.dispatchEvent(dispatch);
	}

	private applyEntries(entries: string[]) {
		const dispatch = new CustomEvent('newLogEntries', {
			detail: { entries }
		});
		this.dispatchEvent(dispatch);
	}

	private async maybeSnapshotAndTruncate(): Promise<void> {
    if (this.idxLastReplicated <= this.lastSnapshotIndex + this.logThreshold) return;
		console.log(`[OBSERVER] ${this.ownId} WRITING SNAPSHOT`);
    const payload = {
      lastIncludedIndex: this.idxLastReplicated,
      lastIncludedTerm: this.currentTerm,
      state: [...this.log],
    };
    await writeSnapshot(payload);
    this.log = [];
		this.logOffset = payload.lastIncludedIndex + 1;
    this.lastSnapshotIndex = payload.lastIncludedIndex;
    this.lastSnapshotTerm = payload.lastIncludedTerm;
  }

	private getLastGlobalIndex(): number {
		return this.logOffset + this.log.length - 1;
	}

	private globalToLocalIndex(globalIndex: number): number | null {
		const localIndex = globalIndex - this.logOffset;
		if (localIndex < 0 || localIndex >= this.log.length) {
			return null
		}
		return localIndex;
	}

	private getLogEntryByGlobalIndex(globalIndex: number): ObservedLogEntry<string> | null {
		const localIndex = this.globalToLocalIndex(globalIndex);
		return localIndex !== null ? this.log[localIndex] : null;
	}

}
