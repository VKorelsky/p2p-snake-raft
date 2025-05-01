import type { Move } from "./types";

export const getRandomNumber = (max: number) => {
	return getRandomNumberInRange(0, max)
};

export const getRandomNumberInRange = (min: number, max: number) => {
	return min + Math.floor(Math.random() * (max - min));
};

export const capitalize = (str: string): string => {
	return str.charAt(0).toUpperCase() + str.slice(1);
};

export const getRandomDirection = (): Move => {
	const directions: Move[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
	return directions[getRandomNumber(directions.length)];
};

export class SystemMessage {
	content: string;

	constructor(content: string) {
		this.content = content;
	}

	toString(): string {
		return `[SYSTEM] ${this.content}`;
	}
}