<script lang="ts">
	import { page } from '$app/state';
	import { PeerPool } from '$lib/peerPool';
	import { Signaler } from '$lib/signaler';
	import { generateRandomString } from '$lib/utils';
	import { onDestroy, onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';

	const circleId = page.params.slug;

	// ================== Message log ==================
	// todo think about API and class design
	let currentSequenceNumber: number = 0;

	const getNextSequenceNumber = () => {
		return (currentSequenceNumber += 1);
	};

	interface IMessage {
		toString: () => string;
	}

	class Message implements IMessage {
		// a message which is part of the shared log
		// no to peer because all messages are broadcast to everyone
		fromPeer: string;
		content: string;
		sequenceNumber: number;

		constructor(fromPeer: string, content: string) {
			this.fromPeer = fromPeer;
			this.content = content;
			this.sequenceNumber = getNextSequenceNumber();
		}

		toString(): string {
			return `[${this.sequenceNumber}][${this.getPeerDisplayName()}] ${this.content}`;
			// return `[${this.sequenceNumber}]${this.content}`;
		}

		private getPeerDisplayName() {
			if (this.fromPeer === ownPeerId) {
				return 'You';
			} else {
				return this.fromPeer;
			}
		}
	}

	class SystemMessage implements IMessage {
		// a message which is not part of the shared log
		content: string;

		constructor(content: string) {
			this.content = content;
		}

		toString(): string {
			return `[SYSTEM] ${this.content}`;
		}
	}
	// ================== END LOG ==================

	let connected: boolean = $state(false);
	let signaler: Signaler | undefined = $state();
	let ownPeerId: string = $state('');

	// TODO this might be a svelte compiler bug?
	// complaining that I am accessing the variable but not declaring it in $state
	// svelte-ignore non_reactive_update
	let connectedPeers: Set<string> = new SvelteSet();
	let messages: IMessage[] = $state([]);

	let peerPool: PeerPool | undefined = $state();

	let autoMessageInterval: number | undefined = $state();

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
			processIncomingMessage(event.detail.peerId, event.detail.message);
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

	const processIncomingMessage = (fromPeerId: string, message: string) => {
		messages.push(new Message(fromPeerId, message));
	};

	const sendMessage = (message: string) => {
		if (peerPool) {
			messages.push(new Message(ownPeerId, message));
			console.log('sending new message' + message);
			peerPool.broadcast(message);
		}
	};

	const toggleAutoMessage = () => {
		if (autoMessageInterval) {
			clearInterval(autoMessageInterval);
			autoMessageInterval = undefined;
		} else {
			const now = new Date();
			const delay = (5 - (now.getSeconds() % 5)) * 1000 - now.getMilliseconds();

			messages.push(
				new SystemMessage(`Sending the next message at ${new Date(now.getTime() + delay)}`)
			);

			setTimeout(() => {
				autoMessageInterval = setInterval(() => {
					sendMessage(generateRandomString());
				}, 5000);
			}, delay);
		}
	};

	const onNewMessage = (e: SubmitEvent) => {
		// prevent form submission
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		const data = new FormData(form);
		const message = data.get('message') as string;

		if (message) {
			console.log('sending message');
			sendMessage(message);
		}

		form.reset();
	};
</script>

<div class="flex flex-col items-center pt-8">
	<h1 class="text-center font-mono text-2xl font-bold text-blue-600">Room <br /> {circleId}</h1>
	<div class="my-7">
		<p class="text-shadow-blue-50"><b>You are</b>: {ownPeerId}</p>
		<p class="text-shadow-blue-50"><b>Connected to room?</b> {connected}</p>
		<p class="text-shadow-blue-50">
			<b>Peers ({connectedPeers.size}): [{Array.from(connectedPeers)}]</b>
		</p>
	</div>
	<div class="flex flex-col items-center space-y-4">
		<div class="flex flex-row space-x-4">
			<button
				class="h-12 w-32 rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
				onclick={connected ? disconnect : connectToSignaler}
			>
				{connected ? 'Disconnect' : 'Connect'}
			</button>
			<button
				class="h-12 w-48 rounded px-4 py-2 font-bold text-white
					{!connected || !peerPool
					? 'cursor-not-allowed bg-gray-400'
					: autoMessageInterval
						? 'bg-red-500 hover:bg-red-700'
						: 'bg-green-500 hover:bg-green-700'}"
				onclick={toggleAutoMessage}
				disabled={!connected || !peerPool}
			>
				{autoMessageInterval ? 'Stop' : 'Start'} Auto-Message
			</button>
			<button
				class="h-12 w-32 rounded bg-gray-500 px-4 py-2 font-bold text-white hover:bg-gray-700"
				onclick={() => (messages = [])}
			>
				Clear
			</button>
		</div>
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
				<li class="m-2 min-w-120 font-mono text-xs">{message}</li>
				<hr class="solid" />
			{/each}
		</ul>
	</div>
</div>
