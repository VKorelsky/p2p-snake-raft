/* eslint-disable @typescript-eslint/no-explicit-any */
export type Move = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

// move to ZOD
export interface Serializable {
	toJson: () => string;
}

export type Stringifiable = {
	toString(): string;
};
export abstract class TypedEventTarget<EventMap extends Record<keyof EventMap, Event>> extends EventTarget {
	addEventListener<K extends keyof EventMap>(
		type: K,
		listener: (this: this, ev: EventMap[K]) => void,
		options?: boolean | AddEventListenerOptions
	): void;
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions
	): void;
	addEventListener(type: string, listener: any, options?: any) {
		super.addEventListener(type, listener, options);
	}

	removeEventListener<K extends keyof EventMap>(
		type: K,
		listener: (this: this, ev: EventMap[K]) => void,
		options?: boolean | EventListenerOptions
	): void;
	removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions
	): void;
	removeEventListener(type: string, listener: any, options?: any) {
		super.removeEventListener(type, listener, options);
	}
}
