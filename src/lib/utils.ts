export const getRandomNumber = (max: number): number => {
	return Math.floor(Math.random() * max);
};

export const capitalize = (str: String): String => {
	return str.charAt(0).toUpperCase() + str.slice(1);
};
