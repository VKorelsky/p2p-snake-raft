<script lang="ts">
	import { page } from '$app/state';
	import { PeerPool } from '$lib/rtc/peerPool';
	import { Signaler } from '$lib/rtc/signaler';
	import type { Move, Stringifiable } from '$lib/types';
	import { getRandomDirection, SystemMessage } from '$lib/utils';
	import { onDestroy, onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import Snake from '../../../components/Snake.svelte';

	const circleId = page.params.slug;

	let connected: boolean = $state(false);
	let signaler: Signaler | undefined = $state();
	let ownPeerId: string = $state('');

	/*
		const logObserver = new LogObserver()

		// join connects to the signaler and initializes the peerPool
		// it then waits until it hears from a leader or triggers an election
		// [DO LATER] here it might also choose to request a snapshot from the leader so it can update it's state
		
		// once it has either become the leader or figured out who the leader is, it's ready to update it's view of the replicated log
		// from the POV of the component that needs stateful log 

		cluster.addEventListener("newLogEntry", (event) => {
			// apply new entries 
			snakeMoves.push(entry.move);
		})

		logObserver.observe()

		const onMovePlayed = (move) => {
			logObserver.share(move);
		}
	*/

	// TODO this might be a svelte compiler bug?
	// complaining that I am accessing the variable but not declaring it in $state
	// svelte-ignore non_reactive_update
	let connectedPeers: Set<string> = new SvelteSet();
	let debugLog: Stringifiable[] = $state([]);
	let snakeMoves: Move[] = $state([]);
	let drawerOpen: boolean = $state(false);

	let peerPool: PeerPool | undefined = $state();

	let autoPlayInterval: number | undefined = $state();
	let autoPlayStartTime: Date | undefined = $state();

	const connectToSignaler = () => {
		debugLog.push(new SystemMessage('connecting the signaler...'));
		signaler = new Signaler(circleId);

		signaler.onConnect((sessionIdentifier) => {
			debugLog.push(new SystemMessage('connected to the signaler...'));
			connected = true;
			ownPeerId = sessionIdentifier;
			// TODO probably a better pattern for doing this rather than relying on component level state
			// will allow avoiding having to explicitly tell TS that the signaler won't be null at peer pool initialization
			initPeerPool();
		});

		signaler.onConnectError((err) => {
			debugLog.push(new SystemMessage(`Error while attempting connection ${err}`));
		});

		signaler.onDisconnect((reason) => {
			debugLog.push(new SystemMessage(`Disconnected from socket. Reason provided is ${reason}`));
			connected = false;
		});
	};

	const initPeerPool = () => {
		peerPool = new PeerPool(ownPeerId, signaler!);

		peerPool.addEventListener('peerConnected', (event: any) => {
			console.log('Peer connected event received:', event.detail);
			debugLog.push(new SystemMessage(`Peer ${event.detail.peerId} connected`));
			connectedPeers.add(event.detail.peerId);
		});

		peerPool.addEventListener('peerDisconnected', (event: any) => {
			console.log('Peer disconnected event received:', event.detail);
			debugLog.push(new SystemMessage(`Peer ${event.detail.peerId} disconnected`));
			connectedPeers.delete(event.detail.peerId);
		});

		peerPool.addEventListener('newMessage', (event: any) => {
			console.log('New message event received:', event.detail);
			processPeerMove(event.detail.peerId, event.detail.message);
		});
	};

	const disconnect = () => {
		debugLog.push(new SystemMessage('disconnecting from the signaler...'));

		if (!signaler) {
			debugLog.push(new SystemMessage('Not connected, nothing to disconnect from'));
			return;
		}

		connected = false;
		// TODO could this be set from the peerPool directly? hmm
		connectedPeers.clear();

		signaler.close();

		if (peerPool) {
			peerPool.close();
		}
	};

	onMount(() => {
		// do nothing for now, eventually maybe connect to the signaler
	});

	onDestroy(() => {
		disconnect();
	});

	const processPeerMove = (fromPeerId: string, move: string) => {
		const isValidDirection = (command: string): command is Move => {
			return ['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(command);
		};

		if (!isValidDirection(move)) {
			debugLog.push(new SystemMessage(`Invalid move received from ${fromPeerId}: ${move}`));
			return;
		}

		debugLog.push(`[${fromPeerId}] - ${move}`);
		snakeMoves.push(move);
	};

	const broadcastMove = (move: Move) => {
		if (peerPool) {
			debugLog.push(`Broadcasting move ${move}`);
			peerPool.broadcast(move);
		}
	};

	const toggleAutoPlay = () => {
		if (autoPlayInterval) {
			clearInterval(autoPlayInterval);
			autoPlayInterval = undefined;
			autoPlayStartTime = undefined;
		} else {
			const now = new Date();
			const delay = (10 - (now.getSeconds() % 10)) * 1000 - now.getMilliseconds();
			const scheduledTime = new Date(now.getTime() + delay);

			autoPlayStartTime = scheduledTime;

			debugLog.push(
				new SystemMessage(`Scheduling the first message to be sent at ${scheduledTime})}`)
			);

			setTimeout(() => {
				autoPlayInterval = setInterval(() => {
					playMove(getRandomDirection());
				}, 10000);
			}, delay);
		}
	};

	// the only messages I can now send are Game commands
	const playMove = (move: Move) => {
		snakeMoves.push(move);
		// messages.push(new SystemMessage(`New move ${move}`));
		broadcastMove(move);
	};
</script>

<div class="relative flex flex-col items-center pt-8">
	<h1 class="text-center font-mono text-2xl font-bold text-blue-600">Snake <br /></h1>
	<!-- LOG DRAWER -->
	<div
		class="fixed top-0 right-0 z-2 h-full w-1/3 bg-white px-6 py-3 shadow-lg transition-transform duration-300"
		style="transform: translateX({drawerOpen ? '0' : '100%'})"
	>
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-lg font-bold">Messages</h2>
			<button
				class="rounded-full bg-red-500 px-2 font-bold text-white hover:bg-red-700"
				onclick={() => (drawerOpen = false)}
			>
				X
			</button>
		</div>
		{#if debugLog.length > 0}
			<div class="items-center">
				<ul>
					{#each debugLog.slice().reverse() as message, i}
						<li class="m-2 font-mono text-xs">{message}</li>
						<hr class="solid" />
					{/each}
				</ul>
			</div>
		{:else}
			<div class="flex h-full w-full grow items-center justify-center overflow-hidden">
				<p>nothing yet!</p>
			</div>
		{/if}
	</div>
	<!-- SHADOW BEHIND THE LOG DRAWER -->
	<div
		class="fixed inset-0 z-1 bg-gray-300 opacity-50 transition-opacity duration-300"
		style="opacity: {drawerOpen ? '0.5' : '0'}; pointer-events: {drawerOpen ? 'auto' : 'none'}"
	></div>

	<!-- ROOM INFO -->
	<div class="my-7">
		<p class="text-shadow-blue-50">
			<b>You are</b>: {ownPeerId ? ownPeerId : 'N/A'} <br /><b>Peers:</b>
			{connectedPeers.size}
		</p>
	</div>

	<!-- ACTIONS -->
	<div class="flex flex-col items-center space-y-4">
		<div class="flex flex-row space-x-4">
			<button
				class="h-auto w-auto rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
				onclick={connected ? disconnect : connectToSignaler}
			>
				{connected ? 'Disconnect' : 'Connect'}
			</button>
			<button
				class="h-auto w-auto rounded px-4 py-2 font-bold text-white
					{!connected || !peerPool
					? 'cursor-not-allowed bg-gray-400'
					: autoPlayInterval
						? 'bg-red-500 hover:bg-red-700'
						: 'bg-green-500 hover:bg-green-700'}"
				onclick={toggleAutoPlay}
				disabled={!connected || !peerPool}
			>
				{autoPlayInterval ? 'Stop' : 'Start'} auto play
			</button>
			<button
				class="h-auto w-auto rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
				onclick={() => (drawerOpen = !drawerOpen)}
			>
				See command log
			</button>
		</div>
	</div>

	<!-- AUTOPLAY INFO IF STARTED -->
	{#if autoPlayStartTime}
		<div class="flex flex-row items-center justify-center pt-5">
			<p class="text-center font-mono text-sm text-gray-600">
				Auto play starting at {autoPlayStartTime.toLocaleTimeString()}
			</p>
		</div>
	{/if}

	<!-- SNAKE -->
	<div class="m-10">
		<Snake actions={snakeMoves} onMove={playMove} />
	</div>
</div>
