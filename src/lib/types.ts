export type Move = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export interface Loggable {
	toString: () => string;
}

export interface Serializable {
    toJson: () => string;
}