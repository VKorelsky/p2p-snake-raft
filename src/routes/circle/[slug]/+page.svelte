<script lang="ts">
	import { page } from '$app/state';
	import { rtcConfig } from '$lib/rtc';
	import type {
		ClientToServerEvents,
		newAnswerEvent,
		newIceCandidateEvent,
		newOfferEvent,
		ServerToClientEvents
	} from '$lib/signaler';
	import { io, type Socket } from 'socket.io-client';
	import { onDestroy, onMount } from 'svelte';

	const circleId = page.params.slug;

	let connected: boolean = $state(false);
	let connectedToPeer: boolean = $state(false);
	let socket: Socket<ServerToClientEvents, ClientToServerEvents> | undefined = $state();
	let peerId: string | undefined = $state('n/a');
	let messages: string[] = $state([]);

	// rtc connection stuff
	let connection: RTCPeerConnection | undefined = $state();
	let otherPeerId: string | undefined = $state();
	let channel: RTCDataChannel | undefined = $state();

	// next step
	// Send a message on the data channel from one peer to another
	// strongly type everything. Also handle better the case where the peer connection could be undefined
	// move functionality to dedicated classes (signaler, peerConnection, peerConnectionPool)

	const sendOfferToPeer = async (toPeerId: string): Promise<void> => {
		if (!socket || !connection) {
			throw new Error('Socket and Connection must be initialized before sending any offer through');
		}
		
		channel = connection.createDataChannel('messaging channel');

		const offer = await connection.createOffer();
		await connection.setLocalDescription(offer);

		channel.addEventListener('open', (event) => {
			console.log('Channel open event:' + event);
			console.log('Channel object:' + channel);

			messages.push(`Data connection channel open with peer ${otherPeerId}`);
		});

		channel.addEventListener('message', (event: any) => {
			console.log('Received new message event on data channel' + event);

			const message = event.data;
			messages.push(`[${otherPeerId}] ${message}`);
		});

		channel.addEventListener('error', (e) => {
			debugger;
			console.log('Error on data channel' + e);
		});

		messages.push(`Sending offer to peer with id ${toPeerId}`);
		socket.emit('sendOffer', toPeerId, offer);
	};

	const sendNewIceCandidate = async (toPeerId: string, newIceCandidate: any): Promise<void> => {
		if (!socket) {
			throw new Error('Socket must be initialized before sending any offer through');
		}

		messages.push(`Sending new ice candidate to peer with id ${toPeerId}`);
		socket.emit('sendIceCandidate', toPeerId, newIceCandidate);
	};

	const handleNewIceCandidate = async (event: newIceCandidateEvent): Promise<void> => {
		try {
			messages.push(`Received new ice candidate from peer with id ${event.fromPeerId}`);
			await connection!.addIceCandidate(event.newIceCandidate);
		} catch (error: any) {
			console.error('Error adding new ice candidate for peer connection', error);
		}
	};

	const handleAnswerFromPeer = async (event: newAnswerEvent): Promise<void> => {
		messages.push(`Got answer from peer with id ${event.fromPeerId}`);
		const remotePeerDescription = new RTCSessionDescription(event.answer);
		await connection!.setRemoteDescription(remotePeerDescription);
	};

	const handleOfferFromPeer = async (event: newOfferEvent): Promise<void> => {
		if (!socket) {
			throw new Error('Socket must be initialized before sending any answer through');
		}

		otherPeerId = event.fromPeerId;
		messages.push(`Got offer from peer with ID ${event.fromPeerId}`);
		connection!.setRemoteDescription(new RTCSessionDescription(event.offer));
		const answer = await connection!.createAnswer();
		await connection!.setLocalDescription(answer);

		messages.push(`Sending back answer to peer with ID ${event.fromPeerId}`);
		socket.emit('sendAnswer', event.fromPeerId, answer);
	};

	const onNewPeer = (newPeerId: string) => {
		messages.push(`New room member. Reconnecting to ${newPeerId}`);
		otherPeerId = newPeerId;

		if (socket) {
			// type RTCPeerConnectionState = "closed" | "connected" | "connecting" | "disconnected" | "failed" | "new";
			if (connection!.connectionState !== 'new') {
				connection!.close();
				connection = new RTCPeerConnection(rtcConfig);
			}

			sendOfferToPeer(newPeerId);
		}
	};

	const connectToSignaler = () => {
		messages.push('connecting the websocket to the server...');
		socket = io(`ws://127.0.0.1:5000?circleId=${circleId}`, {
			reconnectionAttempts: 2,
			// Polling for some reason does not work, has CORS issues
			transports: ['websocket']
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
			socket!.removeAllListeners();
			connected = false;
		});

		socket.on('newRoomMember', onNewPeer);
		socket.on('newAnswer', handleAnswerFromPeer);
		socket.on('newOffer', handleOfferFromPeer);
		socket.on('newIceCandidate', handleNewIceCandidate);
	};

	const newWebRtcConnection = () => {
		const rtcConfig = {
			iceServers: [
				{
					urls: 'stun:stun.relay.metered.ca:80'
				},
				{
					urls: 'turn:global.relay.metered.ca:80',
					username: 'acb86e68047bd92f124b44a6',
					credential: 'mGSHP5Xs9RfJ01aQ'
				},
				{
					urls: 'turn:global.relay.metered.ca:80?transport=tcp',
					username: 'acb86e68047bd92f124b44a6',
					credential: 'mGSHP5Xs9RfJ01aQ'
				},
				{
					urls: 'turn:global.relay.metered.ca:443',
					username: 'acb86e68047bd92f124b44a6',
					credential: 'mGSHP5Xs9RfJ01aQ'
				},
				{
					urls: 'turns:global.relay.metered.ca:443?transport=tcp',
					username: 'acb86e68047bd92f124b44a6',
					credential: 'mGSHP5Xs9RfJ01aQ'
				}
			]
		};

		connection = new RTCPeerConnection(rtcConfig);

		connection!.addEventListener('connectionstatechange', (event) => {
			messages.push(`Change to the RTC connection status, please check the console`);
			if (connection!.connectionState === 'connected') {
				messages.push(`Connected to peer with ID ${otherPeerId}, hello world!`);
				connectedToPeer = true;
			}

			if (connection!.connectionState === 'failed') {
				messages.push('Connection to peer failed..');
			}
		});

		connection!.addEventListener('icecandidateerror', (event) => {
			messages.push(`ICE candidate error: ${event.errorText}`);
		});

		connection!.addEventListener('iceconnectionstatechange', () => {
			const state = connection!.iceConnectionState;
			messages.push(`ICE connection state changed to: ${state}`);

			if (state === 'failed' || state === 'disconnected' || state === 'closed') {
				messages.push('ICE connection failed or closed');
				connectedToPeer = false;
			}
		});

		connection!.addEventListener('icecandidate', (event) => {
			messages.push(`New local ice candidate...`);
			if (event.candidate && otherPeerId) {
				sendNewIceCandidate(otherPeerId, event.candidate);
			}
		});

		connection.addEventListener('datachannel', (event: any) => {
			messages.push(`New data channel initialized by peer...`);
			channel = event.channel;
			channel?.addEventListener('message', (event: any) => {
				console.log('Received new message event on data channel' + event);

				const message = event.data;
				messages.push(`[${otherPeerId}] ${message}`);
			});
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
		if (connection!.connectionState !== 'closed') {
			messages.push('Disconnecting from the other peer');
			connection!.close();
			newWebRtcConnection();
		}
	};

	onMount(() => {
		newWebRtcConnection();
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

		if (connection && otherPeerId && message) {
			sendMessage(otherPeerId, message);
		}
	};

	const sendMessage = async (toPeerId: string, message: string) => {
		messages.push(`[You] - ${message}`);
		console.log('dataChannel' + channel);
		console.log('sending new message' + message);
		// TODO specify a peer
		channel!.send(message);
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
