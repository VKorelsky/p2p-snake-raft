<script lang="ts">
	import { page } from '$app/state';
	import type { Move } from '$lib/model/game';
	import type { IMessage } from '$lib/model/message';
	import { Message, SystemMessage } from '$lib/model/message';
	import { PeerPool } from '$lib/peerPool';
	import { Signaler } from '$lib/signaler';
	import { getRandomDirection } from '$lib/utils';
	import { onDestroy, onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import Snake from '../../../components/Snake.svelte';

	const circleId = page.params.slug;

	let connected: boolean = $state(false);
	let signaler: Signaler | undefined = $state();
	let ownPeerId: string = $state('');

	// TODO this might be a svelte compiler bug?
	// complaining that I am accessing the variable but not declaring it in $state
	// svelte-ignore non_reactive_update
	let connectedPeers: Set<string> = new SvelteSet();
	let messages: IMessage[] = $state([]);
	let moves: Move[] = $state([]);
	let drawerOpen: boolean = $state(false);

	let peerPool: PeerPool | undefined = $state();

	let autoPlayInterval: number | undefined = $state();
	let autoPlayStartTime: Date | undefined = $state();

	const connectToSignaler = () => {
		messages.push(new SystemMessage('connecting the signaler...'));
		signaler = new Signaler(circleId);

		signaler.onConnect((sessionIdentifier) => {
			messages.push(new SystemMessage('connected to the signaler...'));
			connected = true;
			ownPeerId = sessionIdentifier;
			// TODO probably a better pattern for doing this rather than relying on component level state
			// will allow avoiding having to explicitly tell TS that the signaler won't be null at peer pool initialization
			initPeerPool();
		});

		signaler.onConnectError((err) => {
			messages.push(new SystemMessage(`Error while attempting connection ${err}`));
		});

		signaler.onDisconnect((reason) => {
			messages.push(new SystemMessage(`Disconnected from socket. Reason provided is ${reason}`));
			connected = false;
		});
	};

	const initPeerPool = () => {
		peerPool = new PeerPool(ownPeerId, signaler!);

		peerPool.addEventListener('peerConnected', (event: any) => {
			console.log('Peer connected event received:', event.detail);
			messages.push(new SystemMessage(`Peer ${event.detail.peerId} connected`));
			connectedPeers.add(event.detail.peerId);
		});

		peerPool.addEventListener('peerDisconnected', (event: any) => {
			console.log('Peer disconnected event received:', event.detail);
			messages.push(new SystemMessage(`Peer ${event.detail.peerId} disconnected`));
			connectedPeers.delete(event.detail.peerId);
		});

		peerPool.addEventListener('newMessage', (event: any) => {
			console.log('New message event received:', event.detail);
			processPeerMove(event.detail.peerId, event.detail.message);
		});
	};

	const disconnect = () => {
		messages.push(new SystemMessage('disconnecting from the signaler...'));

		if (!signaler) {
			messages.push(new SystemMessage('Not connected, nothing to disconnect from'));
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

	const processPeerMove = (fromPeerId: string, command: string) => {
		const isValidDirection = (command: string): command is Move => {
			return ['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(command);
		};

		if (!isValidDirection(command)) {
			messages.push(new SystemMessage(`Invalid move received from ${fromPeerId}: ${command}`));
			return;
		}

		messages.push(new Message(fromPeerId, command));
		moves.push(command);
	};

	const broadcastMove = (move: Move) => {
		if (peerPool) {
			messages.push(new Message(ownPeerId, move));
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

			messages.push(
				new SystemMessage(`Scheduling the first message to be sent at ${scheduledTime})}`)
			);

			setTimeout(() => {
				autoPlayInterval = setInterval(() => {
					broadcastMove(getRandomDirection());
				}, 10000);
			}, delay);
		}
	};

	// the only messages I can now send are Game commands
	const handleMove = (move: Move) => {
		moves.push(move);
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
		{#if messages.length > 0}
			<div class="items-center">
				<ul>
					{#each messages.slice().reverse() as message, i}
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
	{#if autoPlayStartTime && autoPlayInterval}
	<div class="flex flex-row items-center justify-center pt-5">
		<p class="text-center font-mono text-sm text-gray-600">
			Auto play starting at {autoPlayStartTime.toLocaleTimeString()}
		</p>
	</div>
	{/if}

	<!-- SNAKE -->
	<div class="m-10">
		<Snake actions={moves} onMove={handleMove} />
	</div>
</div>
