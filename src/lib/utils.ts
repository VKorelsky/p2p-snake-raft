export const getRandomNumber = (max: number): number => {
	return Math.floor(Math.random() * max);
};

export const capitalize = (str: string): string => {
	return str.charAt(0).toUpperCase() + str.slice(1);
};

export const log = (message: string, ...data: unknown[]) => {
	console.log(message, data);
};
