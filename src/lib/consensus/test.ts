// abstract class for an event target, which takes generic types for the events that are accepted
// and provides default implementation of the methods such that subclasses only have to implement those

// The example that I can work from
// DOM TYPES
// type EventListenerOrEventListenerObject = EventListener | EventListenerObject;
// CUSTOM TYPES
// interface RTCPeerConnectionEventMap {
//     "connectionstatechange": Event;
//     "datachannel": RTCDataChannelEvent;
//     "icecandidate": RTCPeerConnectionIceEvent;
//     "icecandidateerror": RTCPeerConnectionIceErrorEvent;
//     "iceconnectionstatechange": Event;
//     "icegatheringstatechange": Event;
//     "negotiationneeded": Event;
//     "signalingstatechange": Event;
//     "track": RTCTrackEvent;
// }

// addEventListener<K extends keyof RTCPeerConnectionEventMap>(type: K, listener: (this: RTCPeerConnection, ev: RTCPeerConnectionEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;

// inferred
// interface CustomEvent<T> extends Event {
// 	detail: T;
// 	[key: string]: any;
// }

// the map type is { [key: string]: T extends Event }
// the listener takes a this type which is the event target itself, and the value in the event map, returning any or void

export type CustomEventMap = {
	[key: string]: Event;
};

abstract class CustomEventTarget extends EventTarget {
	addEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject | null,
		options?: AddEventListenerOptions | boolean
	): void {}
}

// implementation
interface TestEventMap extends CustomEventMap {
	hello: Event;
	world: Event;
}

addEventListener<K extends keyof RTCDataChannelEventMap>(type: K, listener: (this: RTCDataChannel, ev: RTCDataChannelEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
