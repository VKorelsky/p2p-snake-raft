<script lang="ts">
	import { page } from '$app/state';
	import {
		Signaler,
		type newAnswerEvent,
		type newIceCandidateEvent,
		type newOfferEvent
	} from '$lib/signaler';
	import { onDestroy, onMount } from 'svelte';

	const circleId = page.params.slug;

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

	let connected: boolean = $state(false);
	let connectedToPeer: boolean = $state(false);
	let signaler: Signaler | undefined = $state();
	let peerId: string | undefined = $state('n/a');
	let messages: string[] = $state([]);

	// rtc connection stuff
	let connection: RTCPeerConnection | undefined = $state();
	let otherPeerId: string | undefined = $state();
	let channel: RTCDataChannel | undefined = $state();

	// next step
	// move functionality to dedicated classes (signaler, peerConnection, peerConnectionPool)
	// first move what you can to the signaler
	// test that it works
	// then start working on a peer pool class, that has it's own signaler instance
	// strongly type everything. Also handle better the case where the peer connection could be undefined

	const sendOfferToPeer = async (toPeerId: string): Promise<void> => {
		if (!signaler || !connection) {
			throw new Error('Signaler and Connection must be initialized before sending any offer through');
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
		signaler.sendOffer(toPeerId, offer);
	};

	const sendNewIceCandidate = async (toPeerId: string, newIceCandidate: any): Promise<void> => {
		if (!signaler) {
			throw new Error('Socket must be initialized before sending any offer through');
		}

		messages.push(`Sending new ice candidate to peer with id ${toPeerId}`);
		signaler.sendIceCandidate(toPeerId, newIceCandidate);
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
		if (!signaler) {
			throw new Error('Socket must be initialized before sending any answer through');
		}

		otherPeerId = event.fromPeerId;
		messages.push(`Got offer from peer with ID ${event.fromPeerId}`);
		connection!.setRemoteDescription(new RTCSessionDescription(event.offer));
		const answer = await connection!.createAnswer();
		await connection!.setLocalDescription(answer);

		messages.push(`Sending back answer to peer with ID ${event.fromPeerId}`);
		signaler.sendAnswer(event.fromPeerId, answer);
	};

	const onNewPeer = (newPeerId: string) => {
		messages.push(`New room member. Reconnecting to ${newPeerId}`);
		otherPeerId = newPeerId;

		if (signaler) {
			// type RTCPeerConnectionState = "closed" | "connected" | "connecting" | "disconnected" | "failed" | "new";
			if (connection!.connectionState !== 'new') {
				connection!.close();
				connection = new RTCPeerConnection(rtcConfig);
			}

			sendOfferToPeer(newPeerId);
		}
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

		signaler.onNewRoomMember(onNewPeer);
		signaler.onNewAnswer(handleAnswerFromPeer);
		signaler.onNewOffer(handleOfferFromPeer);
		signaler.onNewIceCandidate(handleNewIceCandidate);
	};

	const newWebRtcConnection = () => {
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

		return connection;
	};

	const disconnect = () => {
		messages.push('disconnecting from the signaler...');

		if (!signaler) {
			messages.push('Not connected, nothing to disconnect from');
			return;
		}

		connected = false;
		peerId = 'n/a';

		signaler.close();
		if (connection!.connectionState !== 'new') {
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
