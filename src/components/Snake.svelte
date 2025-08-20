<script lang="ts">
	import type { Move } from '$lib/model/game';
	import P5, { type Sketch } from 'p5-svelte';

	let {
		actions,
		onMove
	}: {
		actions: Move[];
		onMove: (move: Move) => void;
	} = $props();

	const cols = 11;
	const rows = 11;
	const gridSize = 30;

	type coord = { x: number; y: number };
	type coordDelta = { dx: number; dy: number };

	const directionDelta: Record<Move, coordDelta> = {
		UP: { dx: 0, dy: -1 },
		DOWN: { dx: 0, dy: 1 },
		LEFT: { dx: -1, dy: 0 },
		RIGHT: { dx: 1, dy: 0 }
	};

	let player = {
		x: 5,
		y: 5,
		path: [] as coord[]
	};

	let processedSteps = 0;
  let previousLength = actions.length;

  $effect.pre(() => {
    if (actions.length < previousLength) {
      processedSteps = 0;
      player = { x: 5, y: 5, path: [{ x: 5, y: 5 }] };
    }
    previousLength = actions.length;
  });

	const sketch: Sketch = (p5) => {
		p5.setup = () => {
			p5.createCanvas(cols * gridSize, rows * gridSize);
			player.x = 5;
			player.y = 5;
			player.path = [{ x: 5, y: 5 }];
		};

		p5.draw = () => {
			p5.background(10);

			// Process next step from pathLog
			if (processedSteps < actions.length) {
				const nextAction = actions[processedSteps];
				const nextMove = directionDelta[nextAction] as { dx: number; dy: number };
				if (nextMove) {
					const newX = player.x + nextMove.dx;
					const newY = player.y + nextMove.dy;

					if (newX >= 0 && newX < cols && newY >= 0 && newY < rows) {
						player.x = newX;
						player.y = newY;
						player.path.push({ x: player.x, y: player.y });
						if (player.path.length > 15) {
							player.path.shift();
						}
					}
				}
				processedSteps++;
			}

			// Draw grid
			p5.stroke(80);
			for (let i = 0; i < cols; i++) {
				for (let j = 0; j < rows; j++) {
					p5.fill(30);
					p5.rect(i * gridSize, j * gridSize, gridSize, gridSize);
				}
			}

			// Draw path
			p5.noStroke();
			p5.fill(100, 200, 255, 150);
			for (let pos of player.path) {
				p5.rect(pos.x * gridSize, pos.y * gridSize, gridSize, gridSize);
			}

			// Draw player
			p5.fill(255, 0, 0);
			p5.rect(player.x * gridSize, player.y * gridSize, gridSize, gridSize);
		};

		p5.keyPressed = () => {
			if (p5.keyIsPressed) {
				let dir: Move | undefined;
				if (p5.keyCode === p5.UP_ARROW) dir = 'UP';
				else if (p5.keyCode === p5.DOWN_ARROW) dir = 'DOWN';
				else if (p5.keyCode === p5.LEFT_ARROW) dir = 'LEFT';
				else if (p5.keyCode === p5.RIGHT_ARROW) dir = 'RIGHT';

				if (dir) {
					onMove(dir);
					return false; // Prevent multiple events
				}
			}
		};
	};
</script>

<P5 {sketch} />
