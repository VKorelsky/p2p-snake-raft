import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import Page from './+page.svelte';

describe('/+page.svelte', () => {
	test('should render h1', () => {
		render(Page);
		expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
	});
});


// //	<div class="mt-12 w-full max-w-md rounded-lg bg-gray-100 p-4 pt-8 shadow-md">
// <ul class="space-y-4">
// {#each messages as message}
// 	<li class="flex flex-col rounded-lg bg-white p-3 shadow-sm">
// 		<span class="font-semibold text-blue-600">{capitalize(message.user)}</span>
// 		<span class="text-gray-700">{message.content}</span>
// 	</li>
// {/each}
// </ul>
// <form {onsubmit} class="pt-8">
// <input
// 	type="text"
// 	name="message"
// 	placeholder="Enter a message"
// 	class="h-12 w-full rounded-md bg-white px-2"
// 	required
// />
// <button
// 	type="submit"
// 	class="mt-4 h-12 w-full rounded bg-blue-500 px-2 font-bold text-white hover:bg-blue-700"
// 	>Send message</button
// >
// </form>
// </div>