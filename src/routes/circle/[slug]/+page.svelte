<script lang="ts">
	import { LogObserver } from '$lib/consensus/logObserver';
	import type { Move } from '$lib/types';
	import { getRandomDirection, getRandomNumberInRange } from '$lib/utils';
	import { onDestroy, onMount } from 'svelte';
	import Snake from '../../../components/Snake.svelte';

	const initLogObserver = (): LogObserver => {
		const observer = new LogObserver(
			electionTimeout
		);

		observer.addEventListener('ready', () => {
			clusterReady = true;
			const obsId = observer.getOwnId();

			if (obsId) {
				ownId = obsId;
			}
		});

		observer.addEventListener('observerStateChange', (event: any) => {
			term = event.detail.term;
			observerType = event.detail.newType;
		});

		observer.addEventListener('peerConnected', () => (connectedPeerCount += 1));
		observer.addEventListener('peerDisconnected', () => (connectedPeerCount -= 1));

		observer.addEventListener('newLogEntry', (event: any) => {
			processNewMove(event.detail!.entry);
		});

		return observer;
	};

	let electionTimeout = $state(getRandomNumberInRange(1000, 2000));
	let logObserver: LogObserver = $state(initLogObserver());
	let connectedPeerCount: number = $state(0);
	let clusterReady: boolean = $state(false);
	let observerType: string = $state('');
	let term: number = $state(0);
	let ownId: string = $state('');

	let snakeMoves: Move[] = $state([]);

	let drawerOpen: boolean = $state(false);
	let autoPlayInterval: number | undefined = $state();
	let autoPlayStartTime: Date | undefined = $state();

	const connect = () => {
		logObserver.connect();
	};

	const disconnect = () => {
		logObserver.leave();
	};

	onMount(() => {
		// do nothing for now, eventually maybe connect to the signaler
	});

	onDestroy(() => {
		disconnect();
	});

	const processNewMove = (move: string) => {
		const isValidDirection = (command: string): command is Move => {
			return ['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(command);
		};

		if (!isValidDirection(move)) {
			console.error(`Invalid move received ${move}`);
			return;
		}

		snakeMoves.push(move);
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

			setTimeout(() => {
				autoPlayInterval = setInterval(() => {
					playMove(getRandomDirection());
				}, 1000);
			}, delay);
		}
	};

	// the only messages I can now send are Game commands
	const playMove = (move: Move) => {
		if (logObserver) {
			logObserver.appendEntry(move);
		}
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
		{#if snakeMoves.length > 0}
			<div class="items-center">
				<ul>
					{#each snakeMoves.slice().reverse() as message, i}
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
	<div class="my-7 space-y-2">
		<p class="text-shadow-blue-50">
			<b>Peers:</b>
			{connectedPeerCount}
		</p>
		<p class="text-shadow-blue-50">
			<b>ElectionTimeout:</b>
			{electionTimeout}
		</p>
		<p class="text-shadow-blue-50">
			<b>Your peer id:</b>
			{ownId}
		</p>
		<p class="text-shadow-blue-50">
			<b>Term:</b>
			{term}
		</p>
		<p class="text-shadow-blue-50">
			<b>Observer Type:</b>
			{observerType}
		</p>
		<p class="text-shadow-blue-50">
			<b>Cluster Ready:</b>
			{clusterReady ? 'Yes' : 'No'}
		</p>
	</div>

	<!-- ACTIONS -->
	<div class="flex flex-col items-center space-y-4">
		<div class="flex flex-row space-x-4">
			<button
				class="h-auto w-auto rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
				onclick={clusterReady ? disconnect : connect}
			>
				{clusterReady ? 'Disconnect' : 'Connect'}
			</button>
			<button
				class="h-auto w-auto rounded px-4 py-2 font-bold text-white
					{!clusterReady
					? 'cursor-not-allowed bg-gray-400'
					: autoPlayInterval
						? 'bg-red-500 hover:bg-red-700'
						: 'bg-green-500 hover:bg-green-700'}"
				onclick={toggleAutoPlay}
				disabled={!clusterReady}
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
