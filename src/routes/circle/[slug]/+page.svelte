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
	let peerConnection: RTCPeerConnection | undefined = $state();
	let otherPeerId: string | undefined = $state();
	let dataChannel: RTCDataChannel | undefined = $state();

	// next step
	// tests
	// exchange data from one to the other
	// strongly type everything. Also handle better the case where the peer connection could be undefined
	// move functionality to dedicated classes (signaler, peerConnection, peerConnectionPool)

	const sendOfferToPeer = async (toPeerId: string): Promise<void> => {
		if (!socket) {
			throw new Error('Socket must be initialized before sending any offer through');
		}

		const offer = await peerConnection!.createOffer();
		await peerConnection!.setLocalDescription(offer);

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
			console.log('New remote ice candidate:', event.newIceCandidate);
			await peerConnection!.addIceCandidate(event.newIceCandidate);
		} catch (error: any) {
			console.error('Error adding new ice candidate for peer connection', error);
		}
	};

	const handleAnswerFromPeer = async (event: newAnswerEvent): Promise<void> => {
		messages.push(`Got answer from peer with id ${event.fromPeerId}`);
		const remotePeerDescription = new RTCSessionDescription(event.answer);
		await peerConnection!.setRemoteDescription(remotePeerDescription);
	};

	const handleOfferFromPeer = async (event: newOfferEvent): Promise<void> => {
		console.log('Offer from peer:', event);

		if (!socket) {
			throw new Error('Socket must be initialized before sending any answer through');
		}

		messages.push(`Got offer from peer with ID ${event.fromPeerId}`);
		peerConnection!.setRemoteDescription(new RTCSessionDescription(event.offer));
		const answer = await peerConnection!.createAnswer();
		await peerConnection!.setLocalDescription(answer);

		messages.push(`Sending back answer to peer with ID ${event.fromPeerId}`);
		socket.emit('sendAnswer', event.fromPeerId, answer);
	};

	const onNewPeer = (newPeerId: string) => {
		messages.push(`New room member. Reconnecting to ${newPeerId}`);
		otherPeerId = newPeerId;

		if (socket) {
			// type RTCPeerConnectionState = "closed" | "connected" | "connecting" | "disconnected" | "failed" | "new";
			if (peerConnection!.connectionState !== 'new') {
				peerConnection!.close();
				peerConnection = new RTCPeerConnection(rtcConfig);
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
		console.log('Creating new RTC peer connection object');

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

		peerConnection = new RTCPeerConnection(rtcConfig);

		peerConnection!.addEventListener('connectionstatechange', (event) => {
			messages.push(`Change to the RTC connection status, please check the console`);
			console.log('New connection change event:', event);
			if (peerConnection!.connectionState === 'connected') {
				messages.push(`Connected to peer with ID ${otherPeerId}, hello world!`);
				connectedToPeer = true;
			}

			if (peerConnection!.connectionState === 'failed') {
				messages.push('Connection to peer failed..');
			}
		});

		peerConnection!.addEventListener('icecandidateerror', (event) => {
			// messages.push(`ICE candidate error: ${event.errorText}`);
			console.error('ICE candidate error:', event);
		});

		peerConnection!.addEventListener('negotiationneeded', (event) => {
			console.log('Negotiation needed event:', event);
		});

		peerConnection!.addEventListener('signalingstatechange', () => {
			if (peerConnection!.signalingState === 'closed') {
				messages.push('Signaling state closed');
			}
			console.log('Signaling state changed to:', peerConnection!.signalingState);
		});

		peerConnection!.addEventListener('iceconnectionstatechange', () => {
			const state = peerConnection!.iceConnectionState;
			messages.push(`ICE connection state changed to: ${state}`);

			if (state === 'failed' || state === 'disconnected' || state === 'closed') {
				messages.push('ICE connection failed or closed');
				connectedToPeer = false;
			}
			console.log('ICE connection state:', state);
		});

		peerConnection!.addEventListener('icecandidate', (event) => {
			console.log('New local ice candidate:', {
				event,
				'candidate?': event.candidate,
				'otherPeerId?': otherPeerId
			});

			if (event.candidate && otherPeerId) {
				sendNewIceCandidate(otherPeerId, event.candidate);
			}
		});

		dataChannel = peerConnection.createDataChannel('messaging channel');

		dataChannel.addEventListener('open', (event) => {
			console.log(event);
			messages.push(`Data connection channel open with peer ${otherPeerId}!! DOUBLE hello world`);
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
		if (peerConnection!.connectionState !== 'closed') {
			messages.push('Disconnecting from the other peer');
			peerConnection!.close();
			newWebRtcConnection();
		}
	};

	onMount(() => {
		newWebRtcConnection();
	});

	onDestroy(() => {
		disconnect();
	});
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
	<div class="mt-8 min-w-1">
		<ul>
			{#each messages.slice().reverse() as message, i}
				<li class="m-2 min-w-120 font-mono text-xs">{messages.length - i}| {message}</li>
				<hr class="solid" />
			{/each}
		</ul>
	</div>
</div>
