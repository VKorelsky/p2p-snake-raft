<script lang="ts">
	import { page } from '$app/state';
	import type { ClientToServerEvents, ServerToClientEvents } from '$lib/signaler';
	import { io, type Socket } from 'socket.io-client';
	import { onDestroy } from 'svelte';

	const circleId = page.params.slug;

	let connected: boolean = $state(false);
	let socket: Socket<ServerToClientEvents, ClientToServerEvents> | undefined = $state();
	let peerId: string | undefined = $state('n/a');
	let messages: string[] = $state([]);

	const connect = () => {
		messages.push('connecting the websocket to the server...');
		socket = io(`ws://127.0.0.1:5000?circleId=${circleId}`, {
			reconnectionAttempts: 2
		});

		socket.on('connect', () => {
			messages.push('connected to the websocket...');
			connected = true;
			peerId = socket!.id;
		});

		socket.on('connect_error', (err) => {
			messages.push(`Error while attempting connection ${err}`);
		});

		socket.on('disconnect', (reason) => {
			messages.push(`Disconnected from socket. Reason provided is ${reason}`);
			connected = false;
		});

		socket.on('newRoomMember', (peerId) => {
			messages.push(`New room member -> id: ${peerId}`);
		});

		socket.onAny((event) => {
			console.log(event);
			messages.push(event);
		});
	};

	const disconnect = () => {
		messages.push('disconnecting the websocket from the server...');

		if (!socket) {
			messages.push('socket does not exist, nothing to disconnect from');
			return;
		}

		connected = false;
		peerId = 'n/a';

		socket.disconnect();
	};

	onDestroy(() => {});
</script>

<div class="flex flex-col items-center pt-8">
	<h1 class="text-center font-mono text-2xl font-bold text-blue-600">Circle <br /> {circleId}</h1>
	<div>
		<p class="mt-7 text-shadow-blue-50"><b>You are</b>: {peerId}</p>
		<p class="mb-7 text-shadow-blue-50"><b>connected to room?</b> {connected}</p>
	</div>
	<div class="flex flex-row">
		<button
			class="col-span-2 mx-8 h-12 w-full rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
			onclick={connect}>connect</button
		>
		<button
			class="col-span-2 mx-8 h-12 w-full rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
			onclick={disconnect}>disconnect</button
		>
		<button
			class="col-span-2 mx-8 h-12 w-full rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
			onclick={() => (messages = [])}>clear</button
		>
	</div>
	<div class="mt-8 min-w-1">
		<ul>
			{#each messages as message}
				<li class="m-2 min-w-120 font-mono">{message}</li>
				<hr class="solid" />
			{/each}
		</ul>
	</div>
</div>
