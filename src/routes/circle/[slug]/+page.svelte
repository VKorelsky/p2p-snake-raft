<script lang="ts">
	import { page } from '$app/state';
	import { Signaler } from '$lib/signaler';
	import { getRandomNumber, capitalize } from '$lib/utils';
	import { onMount } from 'svelte';

	let signaler: Signaler | undefined = $state();

	onMount(() => {
		signaler = new Signaler();
	});

	const names = [
		'John',
		'Amy',
		'Sarah',
		'Michael',
		'Jessica',
		'David',
		'Emily',
		'Daniel',
		'Sophia',
		'Chris'
	];

	const name = names[getRandomNumber(names.length - 1)];

	const circleId = page.params.slug;
	const messages: { user: string; content: string }[] = $state([]);

	const onsubmit = (event: SubmitEvent) => {
		event.preventDefault();
		const formData = new FormData(event.target as HTMLFormElement);
		const message = formData.get('message')?.valueOf() as string;

		messages.push({
			user: name,
			content: message
		});
	};
</script>

<div class="flex flex-col items-center pt-8">
	<h1 class="font-mono text-3xl font-bold text-blue-600">Welcome to circle {circleId}</h1>
	<div class="mt-12 w-full max-w-md rounded-lg bg-gray-100 p-4 pt-8 shadow-md">
		<ul class="space-y-4">
			{#each messages as message}
				<li class="flex flex-col rounded-lg bg-white p-3 shadow-sm">
					<span class="font-semibold text-blue-600">{capitalize(message.user)}</span>
					<span class="text-gray-700">{message.content}</span>
				</li>
			{/each}
		</ul>
		<form {onsubmit} class="pt-8">
			<input
				type="text"
				name="message"
				placeholder="Enter a message"
				class="h-12 w-full rounded-md bg-white px-2"
				required
			/>
			<button
				type="submit"
				class="mt-4 h-12 w-full rounded bg-blue-500 px-2 font-bold text-white hover:bg-blue-700"
				>Send message</button
			>
		</form>
	</div>
</div>
