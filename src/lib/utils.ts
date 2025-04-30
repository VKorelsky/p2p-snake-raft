export const getRandomNumber = (max: number) => {
	return Math.floor(Math.random() * max);
};

export const capitalize = (str: string): string => {
	return str.charAt(0).toUpperCase() + str.slice(1);
};

export const getRandomDirection = () => {
	const directions = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
	return directions[getRandomNumber(directions.length)];
};
