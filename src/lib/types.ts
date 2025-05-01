export type Move = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

// move to ZOD
export interface Serializable {
    toJson: () => string;
}

export type Stringifiable = {
    toString(): string;
  };

// a move will be 
// { move : 'UP' }
// a log entry will be 
// { term: 1, entry: { move: 'UP' }}