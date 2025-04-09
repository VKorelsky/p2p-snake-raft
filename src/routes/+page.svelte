<script lang="ts">
	let circleId = $state('');

	async function createCircle() {
		console.log('Creating connection!');
	}

	async function joinCircle() {
		console.log(`Joining circle with id ${circleId}`);
	}
</script>

<div class="flex flex-col items-center pt-7">
	<div class="grid grid-cols-2 place-items-center gap-8 p-4">
		<svg
			class="col-span-2"
			width="200"
			height="200"
			xmlns="http://www.w3.org/2000/svg"
			xmlns:xlink="http://www.w3.org/1999/xlink"
		>
			<path
				id="circularPath"
				d="M 100,100 m -50,0 a 50,50 0 1,1 100,0 a 50,50 0 1,1 -100,0"
				fill="none"
				stroke="lightgray"
				stroke-width="0"
			/>
			<text style="font-size: 47px; fill: #2b7fff; font-weight: bold">
				<textPath xlink:href="#circularPath" startOffset="0%"> DRUM CIRCLE </textPath>
			</text>
		</svg>

		<button
			class="col-span-2 h-12 w-full rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
			onclick={createCircle}>Create new circle</button
		>
		<input
			class="h-12 w-full rounded border px-3 py-1"
			bind:value={circleId}
			placeholder="Circle ID"
		/>
		<button
			class="h-12 w-full rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
			onclick={joinCircle}
			disabled={circleId.length < 1}>Join circle {circleId}</button
		>
	</div>
</div>
