<script lang="ts">
	import { page } from '$app/state';
	import { PeerConnection } from '$lib/peerPool';
	import { Signaler, type newOfferEvent } from '$lib/signaler';
	import { onDestroy, onMount } from 'svelte';

	const circleId = page.params.slug;

	let connected: boolean = $state(false);
	let connectedToPeer: boolean = $state(false);
	let signaler: Signaler | undefined = $state();
	let messages: string[] = $state([]);
	let peerId: string = $state('');

	// rtc connection stuff
	let connection: PeerConnection | undefined = $state();

	const handleOfferFromPeer = async (event: newOfferEvent): Promise<void> => {
		messages.push(`New offer from peer with id ${event.fromPeerId}. Responding...`);

		if (connection) {
			connection.close();
		}

		connection = createNewConnection(event.fromPeerId);

		const offer = new RTCSessionDescription(event.offer);
		connection.respond(offer);
	};

	const onNewRoomMember = (newPeerId: string) => {
		messages.push(`New room member. Initiating connection with ${newPeerId}`);

		if (connection) {
			// there is an existing connection, shut it down then reconnect to the other peer
			connection.close();
		}

		connection = createNewConnection(newPeerId);
		connection.initiate();
	};

	const createNewConnection = (withPeerId: string) => {
		connection = new PeerConnection(peerId, withPeerId, signaler!);

		// TODO type the whole event listener thing etc
		connection.addEventListener('connectionEstablished', (event: any) => {
			console.log(event);
			connectedToPeer = true;
			messages.push('Connection to peer established');
		});

		connection.addEventListener('connectionFailed', (event: any) => {
			console.log(event);
			messages.push('Connection to peer failed');
		});

		connection.addEventListener('disconnected', (event: any) => {
			console.log(event);
			messages.push('Disconnected from peer');
			connectedToPeer = false;
		});

		connection.addEventListener('newMessage', (event: any) => {
			console.log(event);
			const data = event.detail;
			messages.push(`[${data.peerId}] - ${data.message}`);
		});

		connection.addEventListener('iceCandidateSent', (event: any) => {
			console.log('ice candidate sent:' + event);
			messages.push(`Sent ICE candidate to peer ${event.detail.peerId}`);
		});

		connection.addEventListener('iceCandidateReceived', (event: any) => {
			console.log('ice candidate received:' + event);
			messages.push(`Received ICE candidate from peer ${event.detail.peerId}`);
		});

		return connection;
	};

	const connectToSignaler = () => {
		messages.push('connecting the signaler...');
		signaler = new Signaler(circleId);

		signaler.onConnect((sessionIdentifier) => {
			messages.push('connected to the signaler...');
			connected = true;
			peerId = sessionIdentifier;
		});

		signaler.onConnectError((err) => {
			messages.push(`Error while attempting connection ${err}`);
		});

		signaler.onDisconnect((reason) => {
			messages.push(`Disconnected from socket. Reason provided is ${reason}`);
			connected = false;
		});

		signaler.onNewRoomMember(onNewRoomMember); // peer pool, creates PeerConnection
		signaler.onNewOffer(handleOfferFromPeer); // peer pool, creates a PeerConnection
	};

	const disconnect = () => {
		messages.push('disconnecting from the signaler...');

		if (!signaler) {
			messages.push('Not connected, nothing to disconnect from');
			return;
		}

		connected = false;
		connectedToPeer = false;

		signaler.close();

		if (connection) {
			connection.close();
		}
	};

	onMount(() => {
		// do nothing for now, eventually maybe connect to the signaler
	});

	onDestroy(() => {
		disconnect();
	});

	const onNewMessage = (e: SubmitEvent) => {
		// prevent form submission
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		const data = new FormData(form);
		const message = data.get('message') as string;

		if (connection && message) {
			messages.push(`[You] - ${message}`);
			console.log('sending new message' + message);
			connection.sendMessage(message);
		}
	};
</script>

<div class="flex flex-col items-center pt-8">
	<h1 class="text-center font-mono text-2xl font-bold text-blue-600">Circle <br /> {circleId}</h1>
	<div class="my-7">
		<p class="text-shadow-blue-50"><b>You are</b>: {peerId}</p>
		<p class="text-shadow-blue-50"><b>Connected to room?</b> {connected}</p>
		<p class="text-shadow-blue-50"><b>Connected to peer?</b> {connectedToPeer}</p>
	</div>
	<div class="flex flex-row">
		<button
			class="col-span-2 mx-8 h-12 w-full rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
			onclick={connectToSignaler}>connect</button
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
	<form action="/" class="mt-8 flex flex-row items-center justify-center" onsubmit={onNewMessage}>
		<input class="rounded-md border p-1" type="text" name="message" id="message" />
		<input
			class="col-span-2 mx-8 h-12 w-full rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
			type="submit"
			value="send message"
		/>
	</form>
	<div class="mt-8 min-w-1">
		<ul>
			{#each messages.slice().reverse() as message, i}
				<li class="m-2 min-w-120 font-mono text-xs">{messages.length - i}| {message}</li>
				<hr class="solid" />
			{/each}
		</ul>
	</div>
</div>
